import path from "node:path";

import type { BrowserName } from "./project-options.js";

export { isE2eMobile, parseE2eBrowsers } from "./project-options.js";
export type { BrowserName } from "./project-options.js";

// E2E実行対象のオリジンと、待機/タイムアウトに使う定数を集約する。
// run専用ポートはglobal setup中に決まるため、参照時に環境変数を読む。
export function getTrackingOrigin(): string {
  return `http://localhost:${process.env.PORT ?? 3100}`;
}

export function getDemoSiteOrigin(): string {
  return `http://localhost:${process.env.SITE_PORT ?? 3200}`;
}

/** waitForCondition のデフォルトタイムアウト */
export const DEFAULT_WAIT_TIMEOUT_MS = 5000;
/** Playwright Test が1シナリオの実行を待つ上限 */
export const SCENARIO_TIMEOUT_MS = 60_000;
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
/** GTM History Change 併用テストにおける、同一パスの重複排除ウィンドウ(サーバー側仕様) */
export const DEDUP_WINDOW_MS = 1000;
/** dedup境界を超えた再送を検証する実時間contract。 */
export const DEDUP_RESEND_REAL_TIME_CONTRACT = {
  contractId: "TRACKER-PAGEVIEW-DEDUP-001",
  manualPushWaitMs: DEDUP_WINDOW_MS + 100,
  reason: "同一パスの手動pageviewは1000ms以上で新しい遷移として扱う",
  resendWaitMs: DEDUP_WINDOW_MS + 200,
  toleranceMs: { manualPush: 100, resend: 200 },
} as const;
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

export const REGISTERED_WAIT_DEFINITIONS = {
  "datalayer-manual-dedup-boundary": {
    classification: "product-contract-time-boundary",
    contractId: "TRACKER-PAGEVIEW-DEDUP-001",
    durationMs: DEDUP_RESEND_REAL_TIME_CONTRACT.manualPushWaitMs,
    reason:
      "同一パスの手動pageviewを1000msの重複排除窓より100ms後に送信するため",
    toleranceMs: DEDUP_RESEND_REAL_TIME_CONTRACT.toleranceMs.manualPush,
  },
  "stack-health-poll": {
    classification: "polling",
    contractId: "E2E-STACK-HEALTH-001",
    durationMs: 200,
    reason: "起動したサーバーのhealth応答を成立まで再観測するため",
    toleranceMs: 200,
  },
  "stack-health-request-deadline": {
    classification: "polling",
    contractId: "E2E-STACK-HEALTH-001",
    durationMs: DEFAULT_WAIT_TIMEOUT_MS,
    reason: "health fetchの1回の応答待ちを全体起動期限内に収めるため",
    toleranceMs: DEFAULT_WAIT_TIMEOUT_MS,
  },
  "stack-stop-kill-deadline": {
    classification: "polling",
    contractId: "E2E-STACK-STOP-001",
    durationMs: 5000,
    reason: "SIGKILL後のexit event待機へ5000msの上限を設定するため",
    toleranceMs: 0,
  },
  "stack-stop-term-deadline": {
    classification: "polling",
    contractId: "E2E-STACK-STOP-001",
    durationMs: 5000,
    reason: "SIGTERM後のexit event待機へ5000msの上限を設定するため",
    toleranceMs: 0,
  },
  "tracker-route-interception-deadline": {
    classification: "polling",
    contractId: "E2E-ROUTE-GATE-001",
    durationMs: DEFAULT_WAIT_TIMEOUT_MS,
    reason: "tracker.js要求のroute到達待ちへ5000msの上限を設定するため",
    toleranceMs: 0,
  },
  "tracking-condition-poll": {
    classification: "polling",
    contractId: "E2E-POLL-CONDITION-001",
    durationMs: WAIT_POLL_INTERVAL_MS,
    reason: "Hit・件数・ログの成立条件を再観測する間隔を制御するため",
    toleranceMs: WAIT_POLL_INTERVAL_MS,
  },
  "tracking-fetch-deadline": {
    classification: "polling",
    contractId: "E2E-TRACKING-FETCH-001",
    durationMs: DEFAULT_WAIT_TIMEOUT_MS,
    reason: "計測APIのfetch待ちへ既定5000msの上限を設定するため",
    toleranceMs: DEFAULT_WAIT_TIMEOUT_MS,
  },
  "tracking-observation-poll": {
    classification: "polling",
    contractId: "E2E-POLL-OBSERVATION-001",
    durationMs: WAIT_POLL_INTERVAL_MS,
    reason: "負のcontractと正確件数を観測期限まで再確認するため",
    toleranceMs: WAIT_POLL_INTERVAL_MS,
  },
  "tracking-quiesce-poll": {
    classification: "polling",
    contractId: "E2E-POLL-QUIESCE-001",
    durationMs: QUIESCE_POLL_INTERVAL_MS,
    reason: "Hit ID列が安定期間を満たしたことを再観測するため",
    toleranceMs: QUIESCE_POLL_INTERVAL_MS,
  },
} as const;

export type RegisteredWaitId = keyof typeof REGISTERED_WAIT_DEFINITIONS;

function registeredDuration(
  waitId: RegisteredWaitId,
  requestedMs?: number
): number {
  const definition = REGISTERED_WAIT_DEFINITIONS[waitId];
  const durationMs = requestedMs ?? definition.durationMs;
  const minimumMs = definition.durationMs - definition.toleranceMs;
  const maximumMs = definition.durationMs + definition.toleranceMs;
  if (
    !Number.isFinite(durationMs) ||
    durationMs < minimumMs ||
    durationMs > maximumMs
  ) {
    throw new Error(
      `登録待機の許容幅外: waitId=${waitId}; actual=${durationMs}; expected=${definition.durationMs}±${definition.toleranceMs}ms`
    );
  }
  return durationMs;
}

/** REGISTERED_WAIT_DEFINITIONS に登録した期限 Signal だけを生成する。 */
export function registeredAbortSignal(
  waitId: RegisteredWaitId,
  requestedMs?: number
): AbortSignal {
  return AbortSignal.timeout(registeredDuration(waitId, requestedMs));
}

/** REGISTERED_WAIT_DEFINITIONS に登録した固定待機だけを実行する。 */
export function registeredWait(
  waitId: RegisteredWaitId,
  requestedMs?: number
): Promise<void> {
  const durationMs = registeredDuration(waitId, requestedMs);
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/** Hit.ua に含まれることを期待するブラウザ識別トークン */
export const UA_TOKEN: Record<BrowserName, string> = {
  chromium: "Chrome",
  firefox: "Firefox",
  webkit: "Safari",
};

/** User-Agent に付ける E2E 相関トークンの接頭辞 */
export const E2E_CORRELATION_UA_PREFIX = "td-e2e/";

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

/** シナリオ名を動画ファイル名用の安全な slug に変換する */
export function toScenarioSlug(name: string): string {
  return (
    name
      .trim()
      // ファイル名に使えない記号へマッチする。例: `URL/到達` の `/`。
      .replace(/[/\\?%*:|"<>]/g, "-")
      // 1文字以上の空白へマッチする。例: `URL  到達` の連続空白。
      .replace(/\s+/g, "-")
      // 1文字以上の連続ハイフンへマッチする。例: `URL--到達` の `--`。
      .replace(/-+/g, "-")
      // 文字列の先頭または末尾のハイフンへマッチする。例: `-URL-` の両端。
      .replace(/^-|-$/g, "")
  );
}

/** ブラウザ別の動画出力ディレクトリ(`test-results/videos/{browserName}`) */
export function e2eVideoDir(browserName: BrowserName): string {
  return path.resolve("test-results", "videos", browserName);
}
