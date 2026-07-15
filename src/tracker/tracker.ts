import type { TrackerEventConfig } from "../shared/tracker-config.js";
import { parseTrackerConfig } from "../shared/tracker-config.js";
// 計測スクリプト。esbuild で IIFE にバンドルして /tracker.js として配信する。
// 本番では cdn.example.com/tracker.js からの配信を想定。
// アーキテクチャ: tdDataLayer(dataLayer 方式) + 非同期読み込み + SPA/MPA 両対応。
import type { ParsedTrigger } from "../shared/trigger.js";
import { normalizePath, parseTrigger } from "../shared/trigger.js";

type EventConfig = TrackerEventConfig;

interface DataLayerItem {
  event?: string;
  [key: string]: unknown;
}

const log = (...args: unknown[]) => console.info("[tracker]", ...args);

(function () {
  const w = window as typeof window & {
    tdDataLayer?: DataLayerItem[];
    __trackerLoaded?: boolean;
  };

  // タグの二重設置ガード: 2つ目以降の読み込みは無視する(二重計上防止)
  if (w.__trackerLoaded) {
    console.warn(
      "[tracker] 計測タグが二重に読み込まれています。2つ目以降の読み込みは無視します"
    );
    return;
  }

  // 自身の <script> タグの src からワークスペースIDと計測エンドポイントを解決する
  const self =
    (document.currentScript as HTMLScriptElement | null) ??
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find((s) =>
      s.src.includes("tracker.js")
    );
  if (!self || !self.src) {
    return;
  }
  const selfUrl = new URL(self.src, location.href);
  const wsId = selfUrl.searchParams.get("id");
  const { origin } = selfUrl;
  if (!wsId) {
    console.warn(
      "[tracker] ワークスペースIDがありません(tracker.js?id=ws-xxx)"
    );
    return;
  }
  // ガードは有効なタグとして初期化が確定した時点で立てる。
  // 壊れたタグ(id なし等)が先に読まれても、あとから正しいタグが動けるようにする
  w.__trackerLoaded = true;

  // ---- first-party Cookie による匿名識別 ----
  // why: vid(client_id) は匿名の再訪識別子であり、ログイン紐づけの user_id ではない。
  // why: sid(session_id) は 30 分スライディングのセッション区切りであり、client_id の寿命とは別概念。
  // 計測サーバーは Set-Cookie しない。サイト(:3200)文脈の document.cookie で first-party として扱う。
  const VID_COOKIE = "_td_vid";
  const SID_COOKIE = "_td_sid";
  // why: ブラウザは長い期限を切り詰める(WebKit(libsoup)は1年、Chrome/Firefoxは400日)。
  // why: 1年は全ブラウザが設定値どおり保持する上限。長期の再訪識別はローリング延長が担う。
  const VID_MAX_AGE_SEC = 365 * 24 * 60 * 60; // 1年(ローリング延長)
  const SID_MAX_AGE_SEC = 30 * 60; // 30分(スライディング延長)
  const VID_RE = /^v_[0-9a-f-]{36}$/;
  const SID_RE = /^s_[0-9a-f-]{36}$/;

  function readCookie(name: string): string | null {
    const prefix = `${name}=`;
    let matched: string | null = null;
    for (const part of document.cookie.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        try {
          // 同名 Cookie は Path が長い順に並ぶ。Path=/ の正規 Cookie を優先するため最後の値を使う。
          matched = decodeURIComponent(trimmed.slice(prefix.length));
        } catch {
          // 壊れた percent encoding は欠落と同じ扱いにして匿名 ID を再発行する。
          matched = null;
        }
      }
    }
    return matched;
  }

  function writeCookie(name: string, value: string, maxAgeSec: number): void {
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
  }

  function ensureClientId(): string {
    let vid = readCookie(VID_COOKIE);
    if (!vid || !VID_RE.test(vid)) {
      vid = `v_${crypto.randomUUID()}`;
    }
    // ヒット送信のたびに Max-Age を延長(ローリング)
    writeCookie(VID_COOKIE, vid, VID_MAX_AGE_SEC);
    return vid;
  }

  function ensureSessionId(): string {
    let sid = readCookie(SID_COOKIE);
    // 欠落・期限切れ(ブラウザが Cookie を落とす)・形式不正時のみ再発行
    if (!sid || !SID_RE.test(sid)) {
      sid = `s_${crypto.randomUUID()}`;
    }
    // ヒット送信のたびに 30 分へ延長(スライディング)
    writeCookie(SID_COOKIE, sid, SID_MAX_AGE_SEC);
    return sid;
  }

  // ---- 送信 ----
  function send(eventId: string | null, type: "event" | "pageview"): void {
    const payload = JSON.stringify({
      eventId,
      sid: ensureSessionId(),
      ts: new Date().toISOString(),
      type,
      ua: navigator.userAgent,
      url: location.href,
      vid: ensureClientId(),
      ws: wsId,
    });
    const endpoint = origin + "/api/collect";
    if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, payload))) {
      fetch(endpoint, { body: payload, keepalive: true, method: "POST" }).catch(
        () => {}
      );
    }
  }

  // ---- ページビュー単位の状態 ----
  let events: { cfg: EventConfig; parsed: ParsedTrigger }[] = [];
  let firedThisPage = new Set<string>();
  let timers: number[] = [];
  let currentPath = normalizePath(location.pathname);

  // 直近に送信した pageview のパス・時刻(GTM History Change 併用時の二重計上防止用)
  let lastPageviewPath: string | null = null;
  let lastPageviewTime = 0;
  const DEDUPE_WINDOW_MS = 1000;

  function fire(cfg: EventConfig): void {
    log(`イベント発火: ${cfg.name} (${cfg.trigger})`);
    send(cfg.id, "event");
  }

  function fireOnce(cfg: EventConfig): void {
    if (firedThisPage.has(cfg.id)) {
      return;
    }
    firedThisPage.add(cfg.id);
    fire(cfg);
  }

  // ---- トリガー評価 ----
  function scrollPercent(): number {
    const doc = document.documentElement;
    const total = doc.scrollHeight - window.innerHeight;
    if (total <= 0) {
      return 100;
    }
    return ((window.scrollY || doc.scrollTop) / total) * 100;
  }

  function checkScrollTriggers(): void {
    for (const { cfg, parsed } of events) {
      if (parsed.type !== "scroll") {
        continue;
      }
      if (scrollPercent() >= Number(parsed.value)) {
        fireOnce(cfg);
      }
    }
  }

  // ページビュー開始時の評価: URL到達・滞在時間タイマー・初期スクロール位置
  function onPageview(): void {
    firedThisPage = new Set();
    timers.forEach((t) => clearTimeout(t));
    timers = [];
    send(null, "pageview");
    lastPageviewPath = normalizePath(location.pathname);
    lastPageviewTime = Date.now();
    log(`ページビュー: ${location.pathname}`);

    for (const { cfg, parsed } of events) {
      if (parsed.type === "url") {
        if (normalizePath(location.pathname) === normalizePath(parsed.value)) {
          fireOnce(cfg);
        }
      } else if (parsed.type === "time_on_page") {
        timers.push(
          window.setTimeout(() => fireOnce(cfg), Number(parsed.value) * 1000)
        );
      }
    }
    // 短いページでは読み込み時点で閾値到達していることがある
    checkScrollTriggers();
  }

  // ---- グローバルリスナー(1回だけ登録) ----
  function setupListeners(): void {
    // クリック(委譲)。クリックは1PV内で複数回発火を許容する
    document.addEventListener(
      "click",
      (e) => {
        const target = e.target as Element | null;
        if (!target || !(target instanceof Element)) {
          return;
        }
        for (const { cfg, parsed } of events) {
          if (parsed.type !== "click") {
            continue;
          }
          try {
            if (target.closest(parsed.value)) {
              fire(cfg);
            }
          } catch {
            // 不正なセレクタは無視
          }
        }
      },
      true
    );

    // スクロール率
    window.addEventListener("scroll", checkScrollTriggers, { passive: true });
    window.addEventListener("resize", checkScrollTriggers);

    // 離脱インテント: カーソルがビューポート上端の外へ出た瞬間
    document.addEventListener("mouseout", (e) => {
      if (e.relatedTarget) {
        return;
      }
      if (e.clientY > 0) {
        return;
      }
      for (const { cfg, parsed } of events) {
        if (parsed.type === "exit_intent") {
          fireOnce(cfg);
        }
      }
    });

    // SPA 対応: History API をフックし、パスが変わったら新しいページビューとして扱う
    const onHistoryChange = () => {
      const path = normalizePath(location.pathname);
      if (path === currentPath) {
        return;
      }
      currentPath = path;
      log("History Change を検知(SPA遷移)");
      onPageview();
    };
    const patch = (method: "pushState" | "replaceState") => {
      const orig = history[method].bind(history);
      history[method] = function (...args: Parameters<History["pushState"]>) {
        const ret = orig(...args);
        onHistoryChange();
        return ret;
      };
    };
    patch("pushState");
    patch("replaceState");
    window.addEventListener("popstate", onHistoryChange);
  }

  // ---- dataLayer 連携 ----
  // tdDataLayer.push({event: 'tracker.pageview'}) で手動ページビュー(GTM History Change 連携用)
  function processDataLayerItem(item: DataLayerItem): void {
    if (!item || typeof item !== "object") {
      return;
    }
    if (item.event === "tracker.pageview") {
      const path = normalizePath(location.pathname);
      // GTM の History Change トリガー経由の手動 push は、tracker.js 自身の History API
      // 自動検知(または直前の手動/自動 pageview)と同一パス・1000ms以内であれば
      // 同一遷移の重複通知とみなしてスキップする(pageview・URL到達CVの二重計上防止)。
      // 1000ms を超えた同一パスへの push は、コンテンツ差し替え型SPA等の意図的な
      // 再送とみなし、従来どおり新しいページビューとして扱う
      if (
        lastPageviewPath === path &&
        Date.now() - lastPageviewTime < DEDUPE_WINDOW_MS
      ) {
        log(
          `tracker.pageview の手動送信をスキップ(直近${DEDUPE_WINDOW_MS}ms以内に同一パスのpageview送信済み): ${path}`
        );
        return;
      }
      currentPath = path;
      onPageview();
    }
  }
  function setupDataLayer(): { replayedPageview: boolean } {
    const dl = (w.tdDataLayer = w.tdDataLayer || []);
    // tracker.js は非同期読み込みのため、ロード完了前に push された項目が
    // キューに溜まっている。差し替え前に再生しないと消失する(dataLayer 方式の要)
    let replayedPageview = false;
    for (const item of dl) {
      if (
        item &&
        typeof item === "object" &&
        item.event === "tracker.pageview"
      ) {
        replayedPageview = true;
      }
      processDataLayerItem(item);
    }
    const origPush = dl.push.bind(dl);
    dl.push = function push(...items: DataLayerItem[]) {
      items.forEach(processDataLayerItem);
      return origPush(...items);
    };
    return { replayedPageview };
  }

  // ---- 初期化 ----
  fetch(`${origin}/api/config?id=${encodeURIComponent(wsId)}`)
    .then((r) => {
      if (!r.ok) {
        throw new Error(`config HTTP ${r.status}`);
      }
      return r.json();
    })
    .then((config: unknown) => {
      const parsedConfig = parseTrackerConfig(config);
      if (!parsedConfig) {
        throw new Error("config response is invalid");
      }
      events = parsedConfig
        .map((cfg) => ({ cfg, parsed: parseTrigger(cfg.trigger) }))
        .filter(
          (e): e is { cfg: EventConfig; parsed: ParsedTrigger } =>
            e.parsed !== null
        );
      log(`初期化完了: ws=${wsId}, 有効イベント ${events.length}件`);
      setupListeners();
      const { replayedPageview } = setupDataLayer();
      // キュー再生で現在ページの pageview を処理済みなら初期ページビューを重ねない
      // (1回の実表示で pageview・URL到達イベントが二重計上されるのを防ぐ)
      if (!replayedPageview) {
        onPageview();
      }
    })
    .catch((error) =>
      console.warn("[tracker] 設定の取得に失敗しました", error)
    );
})();
