import path from "node:path";
import { pathToFileURL } from "node:url";

// E2E実行対象のオリジンと、待機/タイムアウトに使う定数を集約する。
export const TRACKING_ORIGIN = `http://localhost:${process.env.PORT ?? 3100}`;
export const DEMO_SITE_ORIGIN = `http://localhost:${process.env.SITE_PORT ?? 3200}`;
export const DB_PATH = process.env.DB_PATH
  ? pathToFileURL(path.resolve(process.env.DB_PATH))
  : new URL("../../../data/db.json", import.meta.url);

/** waitForCondition のデフォルトタイムアウト */
export const DEFAULT_WAIT_TIMEOUT_MS = 5000;
/** waitForCondition のポーリング間隔 */
export const WAIT_POLL_INTERVAL_MS = 200;

/** 滞在時間トリガー・キュー再生系の待機はビーコン到達まで長めに確保する */
export const TIME_ON_PAGE_WAIT_TIMEOUT_MS = 8000;
export const QUEUE_REPLAY_WAIT_TIMEOUT_MS = 8000;

/** quiesceBeacons: 直前テストの遅延ビーコンが着弾しきるまでの最大待機 */
export const QUIESCE_MAX_WAIT_MS = 8000;
/** quiesceBeacons: 件数の再チェック間隔 */
export const QUIESCE_POLL_INTERVAL_MS = 350;
/** quiesceBeacons: この期間件数が変化しなければ「静穏」と判定する */
export const QUIESCE_STABLE_DURATION_MS = 1000;

/** sendBeacon は非同期のため、二重送信があれば着弾するかを確認する猶予 */
export const BEACON_SETTLE_MS = 1500;
/** tracker.js の応答を遅らせ、ロード前キューが消えないことを検証するための遅延 */
export const TRACKER_SCRIPT_DELAY_MS = 800;

/** GTM History Change 併用テストにおける、同一パスの重複排除ウィンドウ(サーバー側仕様) */
export const DEDUP_WINDOW_MS = 1000;
/** 重複排除ウィンドウを確実に超えるための待機(手動再送テスト用) */
export const DEDUP_WINDOW_EXCEEDED_WAIT_MS = DEDUP_WINDOW_MS + 200;
/** 直前の自動検知ページビューから重複排除ウィンドウを超えて手動pushするための待機 */
export const MANUAL_PUSH_GAP_MS = DEDUP_WINDOW_MS + 100;

/** 無効イベント: 受信側の破棄がDBに反映されるまでの待機 */
export const DISABLED_EVENT_RECEIVE_CHECK_DELAY_MS = 500;
/** 無効イベント: 配信除外によりブラウザで発火しないことを確認する待機 */
export const DISABLED_EVENT_BROWSER_CHECK_DELAY_MS = 3000;

/** 検証用フィクスチャイベントの滞在時間トリガー秒数 */
export const TIME_ON_PAGE_TRIGGER_SECONDS = 2;

/** 滞在タイマー破棄検証: 閾値(TIME_ON_PAGE_TRIGGER_SECONDS)未満に留めるHistory遷移の間隔 */
export const TIME_ON_PAGE_CANCEL_BOUNCE_INTERVAL_MS = 400;
/** 滞在タイマー破棄検証: History遷移の繰り返し回数(合計滞在が閾値を確実に超える回数) */
export const TIME_ON_PAGE_CANCEL_BOUNCE_COUNT = 6;

/** モバイル exit_intent 非発火検証用のビューポート(iPhone 12/13 相当) */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };
/** モバイルコンテキストでの離脱インテント非発火チェックの待機 */
export const EXIT_INTENT_MOBILE_CHECK_DELAY_MS = 2000;

/** e2e で直列実行する Playwright ブラウザ名 */
export type BrowserName = "chromium" | "firefox" | "webkit";

/** Hit.ua に含まれることを期待するブラウザ識別トークン */
export const UA_TOKEN: Record<BrowserName, string> = {
  chromium: "Chrome",
  firefox: "Firefox",
  webkit: "Safari",
};

/** seed / デモのワークスペース ID */
export const WORKSPACE_ID = "ws-001";

/** RECORD_VIDEO のパース結果。未設定・不正値は null(録画なし) */
export type RecordVideoMode = "all" | "on-failure";

/** `RECORD_VIDEO=all|on-failure` をパースする。未設定時は null */
export function parseRecordVideoMode(): RecordVideoMode | null {
  const value = process.env.RECORD_VIDEO?.trim().toLowerCase();
  if (value === "all" || value === "on-failure") {
    return value;
  }
  return null;
}

/** `E2E_MOBILE=1` 等の truthy 値でモバイルコンテキスト実行にする */
export function isE2eMobile(): boolean {
  const value = process.env.E2E_MOBILE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

const ALL_BROWSERS: BrowserName[] = ["chromium", "firefox", "webkit"];

/**
 * `E2E_BROWSERS=chromium` または `chromium,firefox` で実行ブラウザを絞る。
 * 未設定時は全ブラウザ。不正な名前は Error。
 */
export function parseE2eBrowsers(): BrowserName[] {
  const raw = process.env.E2E_BROWSERS?.trim();
  if (!raw) {
    return [...ALL_BROWSERS];
  }
  const names = raw.split(",").map((s) => s.trim().toLowerCase());
  const result: BrowserName[] = [];
  for (const name of names) {
    if (name !== "chromium" && name !== "firefox" && name !== "webkit") {
      throw new Error(
        `未知の E2E_BROWSERS 値: ${name} (chromium|firefox|webkit)`
      );
    }
    if (!result.includes(name)) {
      result.push(name);
    }
  }
  if (result.length === 0) {
    throw new Error("E2E_BROWSERS が空です");
  }
  return result;
}

/** シナリオ名を動画ファイル名用の安全な slug に変換する */
export function toScenarioSlug(name: string): string {
  return name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** ブラウザ別の動画出力ディレクトリ(`test-results/videos/{browserName}`) */
export function e2eVideoDir(browserName: BrowserName): string {
  return path.resolve("test-results", "videos", browserName);
}
