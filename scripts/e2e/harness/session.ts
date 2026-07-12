import crypto from "node:crypto";

import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";

import { TrackingClient } from "../tracking/client.js";
import {
  E2E_CORRELATION_UA_PREFIX,
  MOBILE_VIEWPORT,
  TIME_ON_PAGE_TRIGGER_SECONDS,
} from "./config.js";
import type { BrowserName } from "./config.js";
import type { E2eFixtures } from "./types.js";

const TIME_ON_PAGE_TEST_EVENT_NAME = "E2E滞在2秒";
const JAPANESE_URL_TEST_EVENT_NAME = "E2E日本語URL到達";
const EXIT_INTENT_TEST_EVENT_NAME = "E2E離脱インテント";
const FIXTURE_NAME_PREFIX = "__e2e_fixture__";
/** 共有DBに残ったfixtureを次回setupで回収する期限 */
export const E2E_FIXTURE_TTL_MS = 24 * 60 * 60 * 1000;

interface FixtureTrackingClient {
  createEvent: TrackingClient["createEvent"];
  deleteEvent: TrackingClient["deleteEvent"];
  getEventSummaries: TrackingClient["getEventSummaries"];
}

export interface SetupE2eFixturesOptions {
  /** 回帰チェックで所有者を固定する場合だけ指定する。 */
  ownerId?: string;
  /** 回帰チェックで現在時刻を固定する場合だけ指定する。 */
  nowMs?: number;
}

function fixtureName(
  createdAtMs: number,
  ownerId: string,
  name: string
): string {
  return `${FIXTURE_NAME_PREFIX}:${createdAtMs}:${ownerId}:${name}`;
}

function fixtureCreatedAtMs(name: string): number | undefined {
  const match = /^__e2e_fixture__:(\d+):([0-9a-f-]{36}):/.exec(name);
  if (!match) return undefined;
  const createdAtMs = Number(match[1]);
  return Number.isSafeInteger(createdAtMs) ? createdAtMs : undefined;
}

async function cleanupStaleFixtures(
  tracking: FixtureTrackingClient,
  nowMs: number
): Promise<void> {
  const expiresBefore = nowMs - E2E_FIXTURE_TTL_MS;
  const events = await tracking.getEventSummaries();
  for (const event of events) {
    const createdAtMs = fixtureCreatedAtMs(event.name);
    if (createdAtMs !== undefined && createdAtMs < expiresBefore) {
      await tracking.deleteEvent(event.id);
      console.log(`  stale fixture removed: eventId=${event.id}`);
    }
  }
}

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
  /** tracker が送る User-Agent に埋め込む E2E 相関 ID */
  correlationId?: string;
  /** correlationId 指定時に相関トークンを付ける元の User-Agent */
  userAgent?: string;
}

/** BrowserContext を開き、[tracker] ログ収集付きの page を返す */
export async function createE2eSession(
  browser: Browser,
  options: CreateE2eSessionOptions = {}
): Promise<E2eSession> {
  const contextOptions: BrowserContextOptions = {};

  if (options.correlationId) {
    if (!options.userAgent) {
      throw new Error("correlationId 指定時は userAgent が必要です");
    }
    contextOptions.userAgent = `${options.userAgent} ${E2E_CORRELATION_UA_PREFIX}${options.correlationId}`;
  }

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
  return {
    context,
    page,
    trackerLogs,
    tracking: new TrackingClient(options.correlationId),
  };
}

/** シナリオ用に context / page を1組開き、[tracker] ログの収集を開始する */
export async function createE2ePage(browser: Browser): Promise<E2eSession> {
  return createE2eSession(browser);
}

/** 準備: 検証用イベント3件(離脱インテント・滞在2秒・日本語URL)を run 固有名で作成する */
export async function setupE2eFixtures(
  tracking: FixtureTrackingClient,
  options: SetupE2eFixturesOptions = {}
): Promise<E2eFixtures> {
  const nowMs = options.nowMs ?? Date.now();
  const ownerId = options.ownerId ?? crypto.randomUUID();
  const createdEventIds: string[] = [];
  await cleanupStaleFixtures(tracking, nowMs);
  try {
    const exitIntentEventId = await tracking.createEvent({
      description: `E2E fixture owner=${ownerId}`,
      labelIds: [],
      name: fixtureName(nowMs, ownerId, EXIT_INTENT_TEST_EVENT_NAME),
      trigger: "exit_intent",
    });
    createdEventIds.push(exitIntentEventId);
    const timeOnPageEventId = await tracking.createEvent({
      description: `E2E fixture owner=${ownerId}`,
      labelIds: [],
      name: fixtureName(nowMs, ownerId, TIME_ON_PAGE_TEST_EVENT_NAME),
      trigger: `time_on_page:${TIME_ON_PAGE_TRIGGER_SECONDS}`,
    });
    createdEventIds.push(timeOnPageEventId);
    const japaneseUrlEventId = await tracking.createEvent({
      description: `E2E fixture owner=${ownerId}`,
      labelIds: [],
      name: fixtureName(nowMs, ownerId, JAPANESE_URL_TEST_EVENT_NAME),
      trigger: "url:/注文/完了",
    });
    createdEventIds.push(japaneseUrlEventId);
    return { exitIntentEventId, japaneseUrlEventId, timeOnPageEventId };
  } catch (setupError) {
    const cleanupErrors: unknown[] = [];
    for (const eventId of createdEventIds) {
      try {
        await tracking.deleteEvent(eventId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(
        `fixture setupとrollbackに失敗しました: eventIds=${createdEventIds.join(",")}; ` +
          `cleanupErrors=${cleanupErrors.map(String).join(" | ")}`,
        { cause: setupError }
      );
    }
    throw setupError;
  }
}

/** 後片付け: 当該setupが作成した検証用イベントだけを削除する。 */
export async function teardownE2eFixtures(
  tracking: FixtureTrackingClient,
  fixtures: E2eFixtures
): Promise<void> {
  const eventIds = [
    fixtures.exitIntentEventId,
    fixtures.timeOnPageEventId,
    fixtures.japaneseUrlEventId,
  ];
  const errors: unknown[] = [];
  for (const eventId of eventIds) {
    try {
      await tracking.deleteEvent(eventId);
    } catch (error) {
      console.error(
        `fixture teardown failed: eventId=${eventId}: ${String(error)}`
      );
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `fixture teardownに失敗しました: eventIds=${eventIds.join(",")}`
    );
  }
}
