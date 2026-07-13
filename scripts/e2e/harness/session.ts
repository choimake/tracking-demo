import crypto from "node:crypto";

import type { BrowserContext, BrowserContextOptions, Page } from "playwright";

import { TrackingClient } from "../tracking/client.js";
import {
  E2E_CORRELATION_UA_PREFIX,
  MOBILE_VIEWPORT,
  SCENARIO_TIMEOUT_MS,
  TIME_ON_PAGE_TRIGGER_SECONDS,
} from "./config.js";
import type { BrowserName, RecordVideoMode } from "./config.js";
import type {
  E2eBrowserContextFactory,
  E2eFixtures,
  E2ePage,
  E2eRouteHandler,
  E2eRoutePattern,
  ManagedSession,
  ManagedSessionOptions,
} from "./types.js";
import { finalizeOrDiscardVideo, finalizeScenarioVideo } from "./video.js";

const TIME_ON_PAGE_TEST_EVENT_NAME = "E2E滞在2秒";
const JAPANESE_URL_TEST_EVENT_NAME = "E2E日本語URL到達";
const EXIT_INTENT_TEST_EVENT_NAME = "E2E離脱インテント";
const FIXTURE_NAME_PREFIX = "__e2e_fixture__";

function clockPauseLeadMs(): number {
  const configuredTimeoutMs = Number(process.env.E2E_SCENARIO_TIMEOUT_MS);
  return Number.isFinite(configuredTimeoutMs) &&
    configuredTimeoutMs > SCENARIO_TIMEOUT_MS
    ? configuredTimeoutMs
    : SCENARIO_TIMEOUT_MS;
}

// fixture接頭辞内の正規表現メタ文字をリテラルへ変換する。例: `fixture.name` は `fixture\.name` になる。
const FIXTURE_NAME_PREFIX_RE_SOURCE = FIXTURE_NAME_PREFIX.replace(
  /[.*+?^${}()|[\]\\]/g,
  "\\$&"
);
// fixture名 `<接頭辞>:<作成時刻ms>:<owner UUID>:<表示名>` にマッチする。
// 例: `__e2e_fixture__:1770000000000:5c8fba50-7d13-4c25-8a9e-123456789abc:E2E滞在2秒`
const FIXTURE_NAME_RE = new RegExp(
  `^${FIXTURE_NAME_PREFIX_RE_SOURCE}:(\\d+):([0-9a-f-]{36}):`
);
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
  const match = FIXTURE_NAME_RE.exec(name);
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

/** runtime内部で保持するraw session。 */
interface E2eSession {
  context: BrowserContext;
  page: Page;
  trackerLogs: string[];
  tracking: TrackingClient;
}

interface CreateE2eSessionOptions {
  /** BrowserContext の作成をこのfactoryへ委譲する。 */
  contextFactory: E2eBrowserContextFactory;
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

function sessionSetupError(
  setupError: unknown,
  cleanupError: unknown
): AggregateError {
  return new AggregateError(
    [setupError, cleanupError],
    "managed sessionのpage生成とBrowserContextのrollbackに失敗しました",
    { cause: cleanupError }
  );
}

/** BrowserContext を開き、[tracker] ログ収集付きの page を返す */
async function createE2eSession(
  options: CreateE2eSessionOptions
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

  const context = await options.contextFactory(contextOptions);
  try {
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
  } catch (setupError) {
    let cleanupError: unknown;
    try {
      await context.close();
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError !== undefined) {
      throw sessionSetupError(setupError, cleanupError);
    }
    throw setupError;
  }
}

interface ResourceCounter {
  generated: number;
  released: number;
}

export interface ManagedResourceSnapshot {
  contexts: ResourceCounter;
  pages: ResourceCounter;
  routes: ResourceCounter;
}

interface ManagedRouteRecord {
  handler: E2eRouteHandler;
  id: string;
  page: Page;
  pattern: E2eRoutePattern;
  released: boolean;
}

interface ManagedSessionRecord {
  clockInstalled: boolean;
  context: BrowserContext;
  pages: Set<Page>;
  primaryPage: Page;
  recordScenarioVideo: boolean;
  released: boolean;
  routes: Map<string, ManagedRouteRecord>;
  videoFinalized: boolean;
  videoOk?: boolean;
}

export interface CreateManagedE2eRuntimeOptions {
  browserName: BrowserName;
  contextFactory: E2eBrowserContextFactory;
  correlationId: string;
  mobile: boolean;
  recordVideoDir?: string;
  recordVideoMode?: RecordVideoMode;
  scenarioVideoPath?: string;
  userAgent: string;
}

/** fixtureだけが保持するmanaged session runtime。 */
export interface ManagedE2eRuntime {
  readonly session: ManagedSession;
  readonly trackerLogs: string[];
  readonly tracking: TrackingClient;
  close(): Promise<void>;
  finalizeVideo(ok: boolean): Promise<void>;
  resourceSnapshot(): ManagedResourceSnapshot;
  withSession<T>(
    options: ManagedSessionOptions,
    callback: (session: ManagedSession) => Promise<T>
  ): Promise<T>;
}

function copyCounter(counter: ResourceCounter): ResourceCounter {
  return { generated: counter.generated, released: counter.released };
}

function errorDescription(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function combineCallbackAndCleanupErrors(
  callbackFailed: boolean,
  callbackError: unknown,
  cleanupError: unknown
): never {
  if (callbackFailed && cleanupError !== undefined) {
    throw new AggregateError(
      [callbackError, cleanupError],
      `managed session callbackとcleanupに失敗しました: ${errorDescription(callbackError)} | ${errorDescription(cleanupError)}`
    );
  }
  if (callbackFailed) throw callbackError;
  throw cleanupError;
}

class ManagedE2eRuntimeOwner implements ManagedE2eRuntime {
  readonly #contexts: ResourceCounter = { generated: 0, released: 0 };
  readonly #options: CreateManagedE2eRuntimeOptions;
  readonly #pages: ResourceCounter = { generated: 0, released: 0 };
  readonly #root: ManagedSessionRecord;
  readonly #routes: ResourceCounter = { generated: 0, released: 0 };
  readonly #sessions = new Set<ManagedSessionRecord>();
  readonly session: ManagedSession;
  readonly trackerLogs: string[];
  readonly tracking: TrackingClient;

  private constructor(
    options: CreateManagedE2eRuntimeOptions,
    root: E2eSession
  ) {
    this.#options = options;
    this.trackerLogs = root.trackerLogs;
    this.tracking = root.tracking;
    this.#root = this.#registerSession(root, false);
    this.session = this.#capability(this.#root);
  }

  static async create(
    options: CreateManagedE2eRuntimeOptions
  ): Promise<ManagedE2eRuntimeOwner> {
    const root = await createE2eSession({
      browserName: options.browserName,
      contextFactory: options.contextFactory,
      correlationId: options.correlationId,
      mobile: options.mobile,
      recordVideoDir: options.recordVideoDir,
      userAgent: options.userAgent,
    });
    return new ManagedE2eRuntimeOwner(options, root);
  }

  #registerSession(
    session: E2eSession,
    recordScenarioVideo: boolean
  ): ManagedSessionRecord {
    const record: ManagedSessionRecord = {
      clockInstalled: false,
      context: session.context,
      pages: new Set([session.page]),
      primaryPage: session.page,
      recordScenarioVideo,
      released: false,
      routes: new Map(),
      videoFinalized: false,
    };
    this.#contexts.generated += 1;
    this.#pages.generated += 1;
    this.#sessions.add(record);
    return record;
  }

  #capability(record: ManagedSessionRecord): ManagedSession {
    return {
      advanceClockBy: async (durationMs) => {
        if (!record.clockInstalled) {
          throw new Error("Playwright Clockを導入する前に時刻を進められません");
        }
        if (!Number.isFinite(durationMs) || durationMs < 0) {
          throw new Error("Playwright Clockの進行時間は0以上の有限値にします");
        }
        await record.primaryPage.clock.runFor(durationMs);
      },
      clearCookies: () => record.context.clearCookies(),
      cookies: (urls) => record.context.cookies(urls),
      installClock: async () => {
        if (record.clockInstalled) {
          throw new Error("Playwright Clockは同じsessionへ1回だけ導入できます");
        }
        const pauseAtMs = Date.now();
        // pauseAtの過去指定を避けるため、scenario上限以上前から導入する。
        // primary pageはabout:blankであり、この前進中に製品timerは存在しない。
        await record.primaryPage.clock.install({
          time: pauseAtMs - clockPauseLeadMs(),
        });
        await record.primaryPage.clock.pauseAt(pauseAtMs);
        record.clockInstalled = true;
      },
      newPage: async () => {
        const page = await record.context.newPage();
        record.pages.add(page);
        this.#pages.generated += 1;
        return page as unknown as E2ePage;
      },
      page: record.primaryPage as unknown as E2ePage,
      route: (page, pattern, handler) =>
        this.#registerRoute(record, page, pattern, handler),
      unroute: (routeId) => this.#releaseRoute(record, routeId),
    };
  }

  async #registerRoute(
    record: ManagedSessionRecord,
    publicPage: E2ePage,
    pattern: E2eRoutePattern,
    handler: E2eRouteHandler
  ): Promise<string> {
    const page = publicPage as unknown as Page;
    if (!record.pages.has(page)) {
      throw new Error("別sessionのpageへrouteを登録できません");
    }
    const id = crypto.randomUUID();
    await page.route(pattern, handler);
    record.routes.set(id, {
      handler,
      id,
      page,
      pattern,
      released: false,
    });
    this.#routes.generated += 1;
    return id;
  }

  async #releaseRoute(
    record: ManagedSessionRecord,
    routeId: string
  ): Promise<void> {
    const route = record.routes.get(routeId);
    if (!route) {
      throw new Error(`未登録のroute IDです: ${routeId}`);
    }
    if (route.released) return;
    await route.page.unroute(route.pattern, route.handler);
    route.released = true;
    this.#routes.released += 1;
  }

  async #cleanupSession(
    record: ManagedSessionRecord,
    ok: boolean,
    finalizeVideo: boolean
  ): Promise<void> {
    if (finalizeVideo && record.videoOk === undefined) {
      record.videoOk = ok;
    }
    const errors: Error[] = [];
    for (const route of record.routes.values()) {
      if (route.released) continue;
      try {
        await this.#releaseRoute(record, route.id);
      } catch (cause) {
        errors.push(
          new Error(`route解除に失敗しました: routeId=${route.id}`, { cause })
        );
      }
    }
    if (!record.released) {
      try {
        await record.context.close();
        record.released = true;
        this.#contexts.released += 1;
        this.#pages.released += record.pages.size;
      } catch (cause) {
        errors.push(
          new Error("BrowserContextのcloseに失敗しました", { cause })
        );
      }
    }

    if (
      finalizeVideo &&
      record.recordScenarioVideo &&
      !record.videoFinalized &&
      this.#options.recordVideoMode &&
      this.#options.scenarioVideoPath
    ) {
      try {
        await finalizeScenarioVideo({
          mode: this.#options.recordVideoMode,
          ok: record.videoOk ?? ok,
          page: record.primaryPage,
          videoPath: this.#options.scenarioVideoPath,
        });
        record.videoFinalized = true;
      } catch (cause) {
        errors.push(new Error("video cleanupに失敗しました", { cause }));
      }
    }

    const unreleasedRoutes = [...record.routes.values()].filter(
      (route) => !route.released
    ).length;
    if (unreleasedRoutes > 0 || !record.released) {
      errors.push(
        new Error(
          `managed session資源リーク: contexts=${record.released ? 0 : 1}, routes=${unreleasedRoutes}`
        )
      );
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "managed session cleanupに失敗しました");
    }
  }

  async withSession<T>(
    options: ManagedSessionOptions,
    callback: (session: ManagedSession) => Promise<T>
  ): Promise<T> {
    const raw = await createE2eSession({
      browserName: this.#options.browserName,
      contextFactory: this.#options.contextFactory,
      correlationId: this.#options.correlationId,
      mobile: options.mobile,
      recordVideoDir: options.recordScenarioVideo
        ? this.#options.recordVideoDir
        : undefined,
      userAgent: this.#options.userAgent,
    });
    const record = this.#registerSession(
      raw,
      options.recordScenarioVideo === true
    );
    let callbackError: unknown;
    let callbackFailed = false;
    let result: T | undefined;
    try {
      for (const script of options.initScripts ?? []) {
        await record.context.addInitScript(script);
      }
      result = await callback(this.#capability(record));
    } catch (error) {
      callbackFailed = true;
      callbackError = error;
    }
    let cleanupError: unknown;
    try {
      await this.#cleanupSession(record, !callbackFailed, true);
    } catch (error) {
      cleanupError = error;
    }
    if (callbackFailed || cleanupError !== undefined) {
      combineCallbackAndCleanupErrors(
        callbackFailed,
        callbackError,
        cleanupError
      );
    }
    return result as T;
  }

  async close(): Promise<void> {
    const errors: unknown[] = [];
    for (const record of this.#sessions) {
      if (
        record.released &&
        [...record.routes.values()].every((route) => route.released) &&
        (!record.recordScenarioVideo ||
          !this.#options.recordVideoMode ||
          !this.#options.scenarioVideoPath ||
          record.videoFinalized)
      ) {
        continue;
      }
      try {
        await this.#cleanupSession(record, true, record !== this.#root);
      } catch (error) {
        errors.push(error);
      }
    }
    const snapshot = this.resourceSnapshot();
    for (const [name, counter] of Object.entries(snapshot)) {
      if (counter.generated !== counter.released) {
        errors.push(
          new Error(
            `${name}の生成数と解放数が不一致: generated=${counter.generated}, released=${counter.released}`
          )
        );
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "managed E2E runtimeの解放に失敗しました"
      );
    }
  }

  async finalizeVideo(ok: boolean): Promise<void> {
    const { recordVideoMode, scenarioVideoPath } = this.#options;
    if (!(recordVideoMode && scenarioVideoPath)) return;
    await finalizeOrDiscardVideo({
      mode: recordVideoMode,
      ok,
      page: this.#root.primaryPage,
      videoPath: scenarioVideoPath,
    });
  }

  resourceSnapshot(): ManagedResourceSnapshot {
    return {
      contexts: copyCounter(this.#contexts),
      pages: copyCounter(this.#pages),
      routes: copyCounter(this.#routes),
    };
  }
}

/** E2E fixture用のmanaged runtimeを生成する。 */
export function createManagedE2eRuntime(
  options: CreateManagedE2eRuntimeOptions
): Promise<ManagedE2eRuntime> {
  return ManagedE2eRuntimeOwner.create(options);
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
  const failedEventIds: string[] = [];
  for (const eventId of eventIds) {
    try {
      await tracking.deleteEvent(eventId);
    } catch (error) {
      console.error(
        `fixture teardown failed: eventId=${eventId}: ${String(error)}`
      );
      errors.push(error);
      failedEventIds.push(eventId);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `fixture teardownに失敗しました: eventIds=${failedEventIds.join(",")}`
    );
  }
}
