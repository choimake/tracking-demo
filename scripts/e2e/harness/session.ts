import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";

import { TrackingClient } from "../tracking/client.js";
import { EVENT_ID_EXIT_INTENT } from "../tracking/seed-events.js";
import {
  MOBILE_VIEWPORT,
  TIME_ON_PAGE_TRIGGER_SECONDS,
  type BrowserName,
} from "./config.js";
import type { E2eFixtures } from "./types.js";

const TIME_ON_PAGE_TEST_EVENT_NAME = "E2E滞在2秒";
const JAPANESE_URL_TEST_EVENT_NAME = "E2E日本語URL到達";

/** createE2eSession / createE2ePage が返すセッション(context 必須) */
export interface E2eSession {
  context: BrowserContext;
  page: Page;
  trackerLogs: string[];
  tracking: TrackingClient;
}

export interface CreateE2eSessionOptions {
  /** モバイル viewport / hasTouch / isMobile(Firefox 以外) を付与する */
  mobile?: boolean;
  /** 指定時のみ recordVideo: { dir } を有効化する */
  recordVideoDir?: string;
  /** Firefox の isMobile 未サポート回避に必要 */
  browserName?: BrowserName;
}

/** BrowserContext を開き、[tracker] ログ収集付きの page を返す */
export async function createE2eSession(
  browser: Browser,
  options: CreateE2eSessionOptions = {}
): Promise<E2eSession> {
  const contextOptions: BrowserContextOptions = {};

  if (options.mobile) {
    contextOptions.viewport = MOBILE_VIEWPORT;
    contextOptions.hasTouch = true;
    // isMobile は Firefox では未サポート(コンテキスト生成が例外になる)
    if (options.browserName !== "firefox") {
      contextOptions.isMobile = true;
    }
  }

  if (options.recordVideoDir) {
    contextOptions.recordVideo = { dir: options.recordVideoDir };
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const trackerLogs: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().startsWith("[tracker]")) {
      trackerLogs.push(msg.text());
    }
  });
  return { context, page, trackerLogs, tracking: new TrackingClient() };
}

/** テスト全体で使い回すページを1枚開き、[tracker] ログの収集を開始する */
export async function createE2ePage(browser: Browser): Promise<E2eSession> {
  return createE2eSession(browser);
}

/** 準備: 離脱インテントを有効化し、検証用の短い滞在時間イベント(2秒)を作成する */
export async function setupE2eFixtures(
  tracking: TrackingClient
): Promise<E2eFixtures> {
  // 前回異常終了で残った検証用イベントを掃除(同名が複数あると disabled 判定が壊れる)
  const existing = await tracking.getEventSummaries();
  for (const e of existing) {
    if (
      e.name === TIME_ON_PAGE_TEST_EVENT_NAME ||
      e.name === JAPANESE_URL_TEST_EVENT_NAME
    ) {
      await tracking.deleteEvent(e.id).catch(() => {});
    }
  }
  await tracking.toggleEvent(EVENT_ID_EXIT_INTENT, true);
  const timeOnPageEventId = await tracking.createEvent({
    description: "検証用",
    labelIds: [],
    name: TIME_ON_PAGE_TEST_EVENT_NAME,
    trigger: `time_on_page:${TIME_ON_PAGE_TRIGGER_SECONDS}`,
  });
  const japaneseUrlEventId = await tracking.createEvent({
    description: "検証用(URL正規化: 日本語パス)",
    labelIds: [],
    name: JAPANESE_URL_TEST_EVENT_NAME,
    trigger: "url:/注文/完了",
  });
  return { japaneseUrlEventId, timeOnPageEventId };
}

/** 後片付け: 検証用イベントを削除し、離脱インテントを元(無効)に戻す */
export async function teardownE2eFixtures(
  tracking: TrackingClient,
  fixtures: E2eFixtures
): Promise<void> {
  await tracking.deleteEvent(fixtures.timeOnPageEventId).catch(() => {});
  await tracking.deleteEvent(fixtures.japaneseUrlEventId).catch(() => {});
  await tracking.toggleEvent(EVENT_ID_EXIT_INTENT, false).catch(() => {});
}
