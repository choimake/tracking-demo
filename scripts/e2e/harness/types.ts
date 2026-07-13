import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";

import type { TrackingClient } from "../tracking/client.js";
import type { BrowserName } from "./config.js";

export type { EventSummary, HitRecord } from "../tracking/client.js";
export type { BrowserName } from "./config.js";

/** シナリオの診断対象に含める BrowserContext を作成する。 */
export type E2eBrowserContextFactory = (
  options?: BrowserContextOptions
) => Promise<BrowserContext>;

/** setupE2eFixtures が作成し、全テストケースで共有する検証用データ */
export interface E2eFixtures {
  /** 検証用に作成した離脱インテントイベントのID */
  exitIntentEventId: string;
  /** 検証用に作成した「滞在2秒」イベントのID */
  timeOnPageEventId: string;
  /** 検証用に作成した日本語URL到達(`url:/注文/完了`)イベントのID */
  japaneseUrlEventId: string;
}

/** 各テストケース関数に渡される実行コンテキスト */
export interface E2eContext {
  browser: Browser;
  /** Playwright fixture 経由では、追加 BrowserContext の作成に必ず使う。 */
  createBrowserContext?: E2eBrowserContextFactory;
  browserName: BrowserName;
  /** run・browser・scenario を一意に識別する E2E 相関 ID */
  correlationId: string;
  /** 相関トークンを付ける前のブラウザ User-Agent */
  userAgent: string;
  page: Page;
  /** ページの console から収集した "[tracker]" 始まりのログ */
  trackerLogs: string[];
  tracking: TrackingClient;
  fixtures: E2eFixtures;
  /** E2E_MOBILE 相当。外側 session がモバイルコンテキストかどうか */
  mobile: boolean;
  /** RECORD_VIDEO 時のみ。Playwright recordVideo.dir */
  recordVideoDir?: string;
  /** RECORD_VIDEO 時のみ。最終 webm パス(scenario-slug.webm) */
  scenarioVideoPath?: string;
}
