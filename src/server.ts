import path from "node:path";

import { buildSync } from "esbuild";
import express from "express";

import { db, save, newId } from "./db.js";
import { ROOT } from "./paths.js";
import { recommend } from "./recommend.js";
import { parseTrigger } from "./shared/trigger.js";
import type { Hit, TrackEvent } from "./types.js";

const PORT = Number(process.env.PORT ?? 3100);
const DEMO_SITE_URL = process.env.DEMO_SITE_URL ?? "http://localhost:3200";
const app = express();
// text/plain の JSON パースは sendBeacon を受ける /api/collect に限定する。
// 全ルートに許可すると、プリフライトなしの単純リクエストで管理APIへ書き込めてしまう(CSRF)
app.use(
  "/api/collect",
  express.json({ type: ["application/json", "text/plain"] })
);
app.use(express.json());

// ---- 計測スクリプト: TS を起動時にバンドルして配信(CDN 配信の代替) ----
const trackerJs = buildSync({
  bundle: true,
  entryPoints: [path.join(ROOT, "src/tracker/tracker.ts")],
  format: "iife",
  target: "es2018",
  write: false,
}).outputFiles[0].text;

app.get("/tracker.js", (_req, res) => {
  res.type("application/javascript").send(trackerJs);
});

// ---- 計測系 API(サイト側から叩かれるため CORS 許可) ----
function allowCors(res: express.Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

app.get("/api/config", (req, res) => {
  allowCors(res);
  const wsId = String(req.query.id ?? "");
  if (wsId !== db.workspace.id) {
    res.status(404).json({ error: "unknown workspace" });
    return;
  }
  res.json({
    events: db.events
      .filter((e) => e.enabled)
      .map((e) => ({ id: e.id, name: e.name, trigger: e.trigger })),
  });
});

app.options("/api/collect", (_req, res) => {
  allowCors(res);
  res.sendStatus(204);
});

const UA_MAX_LENGTH = 512;
// vid/sid: 空文字は管理画面テスト発火などブラウザ外送信で許容。非空は形式固定
const VID_RE = /^v_[0-9a-f-]{36}$/;
const SID_RE = /^s_[0-9a-f-]{36}$/;

function isAnonIdOk(value: unknown, re: RegExp): boolean {
  if (value === undefined || value === "") {
    return true;
  }
  return typeof value === "string" && re.test(value);
}

app.post("/api/collect", (req, res) => {
  allowCors(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { ws, eventId, type, url, test, ua, vid, sid } = body;
  const isTest = test === true;
  const urlOk =
    url === undefined || (typeof url === "string" && url.length <= 2000);
  const eventIdOk =
    eventId === undefined || eventId === null || typeof eventId === "string";
  const uaOk =
    ua === undefined || (typeof ua === "string" && ua.length <= UA_MAX_LENGTH);
  const vidOk = isAnonIdOk(vid, VID_RE);
  const sidOk = isAnonIdOk(sid, SID_RE);
  if (
    ws !== db.workspace.id ||
    (type !== "event" && type !== "pageview") ||
    !urlOk ||
    !eventIdOk ||
    !uaOk ||
    !vidOk ||
    !sidOk
  ) {
    res.status(400).json({ error: "invalid payload" });
    return;
  }
  if (type === "event") {
    const event = db.events.find((e) => e.id === eventId);
    if (!event) {
      res.status(202).json({ ok: false, reason: "unknown event" });
      return;
    }
    // 無効イベントは計測停止(受信しても記録しない)。テスト発火のみ動作確認のため通す
    if (!event.enabled && !isTest) {
      res.status(202).json({ ok: false, reason: "event disabled" });
      return;
    }
  }
  const hit: Hit = {
    eventId: type === "event" ? (eventId as string) : null,
    id: newId("hit"),
    sid: typeof sid === "string" ? sid : "",
    test: isTest,
    ts: new Date().toISOString(),
    type,
    ua: typeof ua === "string" ? ua : "",
    url: typeof url === "string" ? url : "",
    vid: typeof vid === "string" ? vid : "",
    workspaceId: db.workspace.id,
  };
  db.hits.push(hit);
  save();
  res.status(201).json({ ok: true });
});

// ---- 管理系 API ----
function baseUrl(req: express.Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function buildSnippet(base: string, wsId: string): string {
  return `<!-- 計測タグ -->
<script>
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'tracker.start':new Date().getTime(),event:'tracker.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;
j.src='${base}/tracker.js?id='+i;f.parentNode.insertBefore(j,f);
})(window,document,'script','tdDataLayer','${wsId}');
</script>
<!-- End 計測タグ -->`;
}

// 集計はすべて「直近7日間」(サーバーのローカル日付で数えた7暦日)に統一する。
// イベント一覧の件数とレポートの日別合計が同じ窓を見るようにするため
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function last7LocalDays(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(localDateKey(d));
  }
  return days;
}

function dailyCounts(days: string[], match: (h: Hit) => boolean): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const counts = days.map(() => 0);
  for (const h of db.hits) {
    if (!match(h)) {
      continue;
    }
    const i = index.get(localDateKey(new Date(h.ts)));
    if (i !== undefined) {
      counts[i]++;
    }
  }
  return counts;
}

function count7d(eventId: string): number {
  return dailyCounts(
    last7LocalDays(),
    (h) => h.eventId === eventId && !h.test
  ).reduce((a, b) => a + b, 0);
}

function eventView(e: TrackEvent) {
  return {
    ...e,
    count7d: e.enabled ? count7d(e.id) : 0, // 無効時は0件表示(spec)
    recommendation: recommend(e, db.hits),
  };
}

app.get("/api/workspace", (req, res) => {
  res.json({
    demoUrl: DEMO_SITE_URL,
    endpoint: `${baseUrl(req)}/api/collect`,
    snippet: buildSnippet(baseUrl(req), db.workspace.id),
    workspace: db.workspace,
  });
});

app.put("/api/workspace", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "ワークスペース名を入力してください" });
    return;
  }
  db.workspace.name = name;
  save();
  res.json({ workspace: db.workspace });
});

app.get("/api/events", (_req, res) => {
  res.json({ events: db.events.map(eventView) });
});

function validateEventInput(
  body: unknown
):
  | { name: string; description: string; trigger: string; labelIds: string[] }
  | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const trigger = String(b.trigger ?? "").trim();
  if (!name) {
    return { error: "イベント名を入力してください" };
  }
  if (!parseTrigger(trigger)) {
    return {
      error:
        "トリガーの値が不正です。URL到達は「/」で始まるパス(?と#は含められません)、クリックはCSSセレクタ、滞在時間は1〜86400の整数(秒)、スクロール率は1〜100の整数を入力してください",
    };
  }
  const labelIds = Array.isArray(b.labelIds)
    ? b.labelIds.map(String).filter((id) => db.labels.some((l) => l.id === id))
    : [];
  return {
    description: String(b.description ?? "").trim(),
    labelIds,
    name,
    trigger,
  };
}

app.post("/api/events", (req, res) => {
  const input = validateEventInput(req.body);
  if ("error" in input) {
    res.status(400).json(input);
    return;
  }
  const now = new Date().toISOString();
  const event: TrackEvent = {
    id: newId("ev"),
    workspaceId: db.workspace.id,
    ...input,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  db.events.push(event);
  save();
  res.status(201).json({ event: eventView(event) });
});

app.put("/api/events/:id", (req, res) => {
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const input = validateEventInput(req.body);
  if ("error" in input) {
    res.status(400).json(input);
    return;
  }
  Object.assign(event, input, { updatedAt: new Date().toISOString() });
  save();
  res.json({ event: eventView(event) });
});

app.post("/api/events/:id/toggle", (req, res) => {
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) {
    res.status(404).json({ error: "not found" });
    return;
  }
  event.enabled = req.body?.enabled === true;
  event.updatedAt = new Date().toISOString();
  save();
  res.json({ event: eventView(event) });
});

app.delete("/api/events/:id", (req, res) => {
  const i = db.events.findIndex((e) => e.id === req.params.id);
  if (i === -1) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const [removed] = db.events.splice(i, 1);
  db.hits = db.hits.filter((h) => h.eventId !== removed.id);
  save();
  res.json({ ok: true });
});

// イベント単位のテスト発火(▷): 実際の受信経路(/api/collect)を通して
// テストヒットを記録する。件数には含めない
async function fireEventTest(
  req: express.Request,
  res: express.Response,
  event: TrackEvent
): Promise<void> {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/collect`, {
      body: JSON.stringify({
        ws: db.workspace.id,
        eventId: event.id,
        type: "event",
        url: `${baseUrl(req)}/admin (テスト発火)`,
        test: true,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (r.status !== 201) {
      throw new Error(`collect HTTP ${r.status}`);
    }
    res.json({
      message: `イベント「${event.name}」のテスト発火を記録しました(計測件数には含まれません)`,
      ok: true,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: `テスト発火に失敗しました: ${(error as Error).message}` });
  }
}

// Express 4 は async ハンドラの reject を自動処理しない(未捕捉だとプロセスクラッシュに
// つながる)ため、ハンドラ本体は非 async にし、内部で await する処理は try/catch で回収する
app.post("/api/events/:id/test", (req, res, next) => {
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) {
    res.status(404).json({ error: "not found" });
    return;
  }
  void (async () => {
    try {
      await fireEventTest(req, res, event);
    } catch (error) {
      next(error);
    }
  })();
});

// タグ設置の動作検証: since 以降に受信した pageview を返す
app.get("/api/tag-check", (req, res) => {
  const since = Number(req.query.since ?? 0);
  const hits = db.hits.filter(
    (h) => h.type === "pageview" && !h.test && new Date(h.ts).getTime() >= since
  );
  res.json({ count: hits.length, hits: hits.slice(-10) });
});

// ---- ラベル API ----
app.get("/api/labels", (_req, res) => {
  const usage = new Map<string, number>();
  for (const e of db.events) {
    for (const id of e.labelIds) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  res.json({
    labels: db.labels.map((l) => ({ ...l, eventCount: usage.get(l.id) ?? 0 })),
  });
});

app.post("/api/labels", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "ラベル名を入力してください" });
    return;
  }
  // color は style 属性に挿入されるため #RRGGBB のみ許可(CSS インジェクション防止)
  const color = String(req.body?.color ?? "#8b8d98");
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    res
      .status(400)
      .json({ error: "ラベル色は #RRGGBB 形式で指定してください" });
    return;
  }
  const label = { color, id: newId("lb"), name };
  db.labels.push(label);
  save();
  res.status(201).json({ label });
});

app.delete("/api/labels/:id", (req, res) => {
  const i = db.labels.findIndex((l) => l.id === req.params.id);
  if (i === -1) {
    res.status(404).json({ error: "not found" });
    return;
  }
  db.labels.splice(i, 1);
  for (const e of db.events) {
    e.labelIds = e.labelIds.filter((id) => id !== req.params.id);
  }
  save();
  res.json({ ok: true });
});

// ---- レポート API: イベント×直近7日間の日別件数(count7d と同じ集計窓) ----
app.get("/api/report", (_req, res) => {
  const days = last7LocalDays();
  const rows = db.events.map((e) => {
    const counts = dailyCounts(days, (h) => h.eventId === e.id && !h.test);
    return {
      counts,
      enabled: e.enabled,
      eventId: e.id,
      name: e.name,
      total: counts.reduce((a, b) => a + b, 0),
      trigger: e.trigger,
    };
  });
  const pageviews = dailyCounts(days, (h) => h.type === "pageview" && !h.test);
  res.json({ days, pageviews, rows });
});

// ---- 管理画面 ----
app.get("/", (_req, res) => res.redirect("/admin"));
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(ROOT, "public/admin.html"));
});

app.listen(PORT, () => {
  console.log(`管理画面(計測サーバー): http://localhost:${PORT}/admin`);
});
