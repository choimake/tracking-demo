import {
  DEFAULT_WAIT_TIMEOUT_MS,
  BEACON_SETTLE_MS,
  WAIT_POLL_INTERVAL_MS,
  QUIESCE_MAX_WAIT_MS,
  QUIESCE_POLL_INTERVAL_MS,
  QUIESCE_STABLE_DURATION_MS,
  registeredWait,
} from "../harness/config.js";
import {
  assertionError,
  formatAssertionFailure,
} from "./assertion-formatter.js";
import type { HitFilter, HitRecord, TrackingClient } from "./client.js";

type HitReader = Pick<TrackingClient, "getHitsMatching">;
type TagCheckReader = Pick<TrackingClient, "getTagCheck">;
type EventCountReader = Pick<TrackingClient, "getEventCount7d">;

interface ObservationOptions {
  observationMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface QuiesceOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  stableDurationMs?: number;
}

const E2E_ASSERTIONS_STARTED_AT_MS = Date.now();

export interface WaitObservation<T> {
  actual: T;
  ready: boolean;
}

class WaitTimeoutError extends Error {}

function observedValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

/** 条件が成立するまで観測し、timeout時は最終観測値を報告する。 */
export async function waitForCondition<T>(
  label: string,
  fn: () => Promise<WaitObservation<T>>,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastObserved: T | "未観測" = "未観測";
  while (Date.now() < deadline) {
    const observation = await fn();
    lastObserved = observation.actual;
    if (observation.ready) {
      console.log(`  ✓ ${label}`);
      return observation.actual;
    }
    await registeredWait(
      "tracking-condition-poll",
      Math.min(WAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))
    );
  }
  throw new WaitTimeoutError(
    formatAssertionFailure({
      actual: { finalObserved: lastObserved },
      context: { condition: label, timeoutMs },
      expected: { ready: true },
      name: "wait-for-condition",
      summary: `待機timeout: condition=${label}; timeoutMs=${timeoutMs}; finalObserved=${observedValue(lastObserved)}`,
    })
  );
}

async function observeUntilDeadline(
  observationMs: number,
  pollIntervalMs: number,
  observe: () => Promise<void>
): Promise<void> {
  const deadline = Date.now() + observationMs;
  while (Date.now() < deadline) {
    await observe();
    await registeredWait(
      "tracking-observation-poll",
      Math.min(
        pollIntervalMs,
        WAIT_POLL_INTERVAL_MS,
        Math.max(0, deadline - Date.now())
      )
    );
  }
  await observe();
}

function assertExactCount(actualCount: number, expectedCount: number): void {
  if (actualCount !== expectedCount) {
    throw assertionError({
      actual: { count: actualCount },
      expected: { count: expectedCount },
      name: "hit-count-exactly",
      summary: `Hit 件数が不一致: got=${actualCount} want=${expectedCount}`,
    });
  }
}

function assertZeroCount(actualCount: number): void {
  if (actualCount !== 0) {
    throw assertionError({
      actual: { count: actualCount },
      expected: { count: 0 },
      name: "hit-count-zero-during-observation",
      summary: `観測期間中の Hit 件数が不一致: got=${actualCount} want=0`,
    });
  }
}

/**
 * ビーコン静穏待ち: 現在のシナリオと相関する Hit ID 列が一定期間変化しないことを確認する。
 * 他シナリオの遅延ビーコンは相関 ID で除外する。
 */
export async function quiesceBeacons(
  tracking: HitReader,
  options: QuiesceOptions = {}
): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? QUIESCE_MAX_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? QUIESCE_POLL_INTERVAL_MS;
  const stableDurationMs =
    options.stableDurationMs ?? QUIESCE_STABLE_DURATION_MS;
  const hitIds = async () =>
    (await tracking.getHitsMatching({})).map((hit) => hit.id).join("\n");
  const deadline = Date.now() + maxWaitMs;
  let previousHitIds = await hitIds();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await registeredWait(
      "tracking-quiesce-poll",
      Math.min(
        pollIntervalMs,
        QUIESCE_POLL_INTERVAL_MS,
        Math.max(0, deadline - Date.now())
      )
    );
    const currentHitIds = await hitIds();
    if (currentHitIds !== previousHitIds) {
      previousHitIds = currentHitIds;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableDurationMs) {
      return;
    }
  }
  const actualStableMs = Date.now() - stableSince;
  throw assertionError({
    actual: {
      hitIds: previousHitIds.split("\n").filter(Boolean),
      stableMs: actualStableMs,
    },
    expected: { stableMs: stableDurationMs },
    name: "beacon-quiescence",
    summary: `ビーコン静穏待ちが ${maxWaitMs}ms で timeout: actual=安定${actualStableMs}ms expected=安定${stableDurationMs}ms; hitIds=${JSON.stringify(previousHitIds.split("\n").filter(Boolean))}`,
  });
}

export async function expectEventCountExactlyIncreasedBy(
  tracking: EventCountReader,
  eventId: string,
  countBefore: number,
  expectedDelta: number,
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  const expectedCount = countBefore + expectedDelta;
  let lastActualCount: number | undefined;
  try {
    await waitForCondition(
      label,
      async () => {
        const actualCount = await tracking.getEventCount7d(eventId);
        lastActualCount = actualCount;
        if (actualCount > expectedCount) {
          throw assertionError({
            actual: { count: actualCount },
            context: { eventId, label },
            expected: { count: expectedCount },
            name: "event-count-increase",
            summary: `イベント件数が期待値を超過: got=${actualCount} want=${expectedCount}`,
          });
        }
        return {
          actual: { actualCount, expectedCount },
          ready: actualCount === expectedCount,
        };
      },
      timeoutMs
    );
  } catch (error) {
    if (error instanceof WaitTimeoutError) {
      throw assertionError(
        {
          actual: { count: lastActualCount ?? null },
          context: {
            eventId,
            label,
            timeoutDiagnostic: error.message,
          },
          expected: { count: expectedCount },
          name: "event-count-increase",
          summary: `イベント件数が期待値へ未到達: got=${lastActualCount ?? "未取得"} want=${expectedCount}; ${error.message}`,
        },
        error
      );
    }
    throw error;
  }
  await observeUntilDeadline(
    BEACON_SETTLE_MS,
    WAIT_POLL_INTERVAL_MS,
    async () => {
      assertExactCount(await tracking.getEventCount7d(eventId), expectedCount);
    }
  );
  console.log(`  ✓ ${label}: 正確に+${expectedDelta}件`);
}

export async function expectHitCountAtLeast(
  tracking: HitReader,
  filter: HitFilter,
  minCount: number,
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  let lastActualCount: number | undefined;
  try {
    await waitForCondition(
      label,
      async () => {
        lastActualCount = (await tracking.getHitsMatching(filter)).length;
        return {
          actual: { actualCount: lastActualCount, minCount },
          ready: lastActualCount >= minCount,
        };
      },
      timeoutMs
    );
  } catch (error) {
    if (error instanceof WaitTimeoutError) {
      throw assertionError(
        {
          actual: { count: lastActualCount ?? null },
          context: { filter, label, timeoutDiagnostic: error.message },
          expected: { minimumCount: minCount },
          name: "hit-count-at-least",
          summary: `Hit 件数が期待値へ未到達: got=${lastActualCount ?? "未取得"} min=${minCount}; ${error.message}`,
        },
        error
      );
    }
    throw error;
  }
}

/** cursor 以降の pageview が最低N件に到達するまで待つ。 */
export async function expectPageviewCountAtLeast(
  tracking: HitReader,
  afterHitId: string | undefined,
  minCount: number,
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  await expectHitCountAtLeast(
    tracking,
    { afterHitId, eventId: null, type: "pageview" },
    minCount,
    label,
    timeoutMs
  );
}

/** 期待件数への到達後も観測を続け、観測期間を通して正確にN件であることを保証する。 */
export async function expectHitCountExactly(
  tracking: HitReader,
  filter: HitFilter,
  expectedCount: number,
  label: string,
  options: ObservationOptions = {}
): Promise<void> {
  const observationMs = options.observationMs ?? BEACON_SETTLE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? WAIT_POLL_INTERVAL_MS;
  if (expectedCount > 0) {
    await expectHitCountAtLeast(
      tracking,
      filter,
      expectedCount,
      label,
      options.timeoutMs
    );
  }
  await observeUntilDeadline(observationMs, pollIntervalMs, async () => {
    assertExactCount(
      (await tracking.getHitsMatching(filter)).length,
      expectedCount
    );
  });
  console.log(`  ✓ ${label}: 正確に${expectedCount}件`);
}

/** cursor 以降の pageview が観測期間を通して正確にN件であることを保証する。 */
export async function expectPageviewCountExactly(
  tracking: HitReader,
  afterHitId: string | undefined,
  expectedCount: number,
  label: string,
  options: ObservationOptions = {}
): Promise<void> {
  await expectHitCountExactly(
    tracking,
    { afterHitId, eventId: null, type: "pageview" },
    expectedCount,
    label,
    options
  );
}

/** 相関 ID が一致するイベントが観測期間を通して正確にN件であることを保証する。 */
export async function expectEventCountExactly(
  tracking: HitReader,
  eventId: string,
  expectedCount: number,
  label: string,
  options: ObservationOptions = {}
): Promise<void> {
  await expectHitCountExactly(
    tracking,
    { eventId, type: "event" },
    expectedCount,
    label,
    options
  );
}

/** 観測期間を通して最大N件であることを保証する。 */
export async function expectHitCountAtMost(
  tracking: HitReader,
  filter: HitFilter,
  maximumCount: number,
  label: string,
  options: ObservationOptions = {}
): Promise<void> {
  await observeUntilDeadline(
    options.observationMs ?? BEACON_SETTLE_MS,
    options.pollIntervalMs ?? WAIT_POLL_INTERVAL_MS,
    async () => {
      const actualCount = (await tracking.getHitsMatching(filter)).length;
      if (actualCount > maximumCount) {
        throw assertionError({
          actual: { count: actualCount },
          context: { filter, label },
          expected: { maximumCount },
          name: "hit-count-at-most",
          summary: `Hit 件数が上限超過: got=${actualCount} max=${maximumCount}`,
        });
      }
    }
  );
  console.log(`  ✓ ${label}: 最大${maximumCount}件`);
}

/** 観測期間を通して0件であることを保証する。 */
export async function expectNoHitsDuringObservation(
  tracking: HitReader,
  filter: HitFilter,
  label: string,
  options: ObservationOptions = {}
): Promise<void> {
  await observeUntilDeadline(
    options.observationMs ?? BEACON_SETTLE_MS,
    options.pollIntervalMs ?? WAIT_POLL_INTERVAL_MS,
    async () => {
      assertZeroCount((await tracking.getHitsMatching(filter)).length);
    }
  );
  console.log(`  ✓ ${label}: 観測期間中0件`);
}

/** `/api/tag-check` が指定した Hit を返すことを検証する。 */
export async function expectTagCheckContainsHit(
  tracking: TagCheckReader,
  hit: HitRecord
): Promise<void> {
  const tagCheck = await tracking.getTagCheck(Date.parse(hit.ts));
  if (!tagCheck.hits.some((tagCheckHit) => tagCheckHit.id === hit.id)) {
    const actualHitIds = tagCheck.hits.map((item) => item.id);
    throw assertionError({
      actual: { hitIds: actualHitIds },
      expected: { hitId: hit.id },
      name: "tag-check-contains-hit",
      summary: `/api/tag-check の応答に受信済み pageview が含まれない: actualHitIds=${JSON.stringify(actualHitIds)} expectedHitId=${hit.id}`,
    });
  }
  console.log("  ✓ /api/tag-check が受信済み pageview を返す");
}

export async function expectTrackerLogContains(
  trackerLogs: string[],
  substring: string,
  label: string,
  sinceIndex = 0,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  try {
    await waitForCondition(
      label,
      async () => {
        const logs = trackerLogs.slice(sinceIndex);
        return {
          actual: logs,
          ready: logs.some((line) => line.includes(substring)),
        };
      },
      timeoutMs
    );
  } catch (error) {
    if (error instanceof WaitTimeoutError) {
      const actualLogs = trackerLogs.slice(sinceIndex);
      throw assertionError(
        {
          actual: { logs: actualLogs },
          context: { label, sinceIndex, timeoutDiagnostic: error.message },
          expected: { substring },
          name: "tracker-log-contains",
          summary: `tracker log が期待文字列を含みません: actual=${JSON.stringify(actualLogs)} expectedSubstring=${JSON.stringify(substring)}; ${error.message}`,
        },
        error
      );
    }
    throw error;
  }
}

/**
 * cursor 以降に着弾した相関 ID 一致ヒットを待つ。件数アサーションのあとに呼び、
 * ヒット単位の payload / ts / ua 検証に使う
 */
export async function waitForNewHit(
  tracking: TrackingClient,
  filter: HitFilter,
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<HitRecord> {
  await expectHitCountAtLeast(tracking, filter, 1, label, timeoutMs);
  const found = (await tracking.getHitsMatching(filter)).at(-1);
  if (!found) {
    throw assertionError({
      actual: { count: 0 },
      context: { filter, label },
      expected: { minimumCount: 1 },
      name: "new-hit-exists",
      summary: `Hit 取得結果が不一致: actual=0件 expected=1件以上; label=${label}`,
    });
  }
  return found;
}

export interface ExpectedHitPayload {
  eventId?: string | null;
  type?: "event" | "pageview";
  urlIncludes?: string;
  workspaceId?: string;
  uaIncludes?: string;
  /** 指定時は hit.vid と完全一致 */
  vid?: string;
  /** 指定時は hit.sid と完全一致 */
  sid?: string;
}

/** 匿名vid（`v_` + UUID）にマッチする。例: `v_123e4567-e89b-12d3-a456-426614174000` */
export const ANON_VID_RE = /^v_[0-9a-f-]{36}$/;
/** 匿名sid（`s_` + UUID）にマッチする。例: `s_123e4567-e89b-12d3-a456-426614174000` */
export const ANON_SID_RE = /^s_[0-9a-f-]{36}$/;

/** vid/sidが匿名ID形式に一致することを検証する。 */
export function expectAnonIdentityValues(vid: string, sid: string): void {
  if (!ANON_VID_RE.test(vid)) {
    throw assertionError({
      actual: { vid },
      expected: { vid: "v_<UUID>" },
      name: "anonymous-vid-format",
      summary: `hit.vid の形式が不正または空: actual=${JSON.stringify(vid)} expected=v_<UUID>（例: v_123e4567-e89b-12d3-a456-426614174000）`,
    });
  }
  if (!ANON_SID_RE.test(sid)) {
    throw assertionError({
      actual: { sid },
      expected: { sid: "s_<UUID>" },
      name: "anonymous-sid-format",
      summary: `hit.sid の形式が不正または空: actual=${JSON.stringify(sid)} expected=s_<UUID>（例: s_123e4567-e89b-12d3-a456-426614174000）`,
    });
  }
}

/** ヒットに形式付きの非空 vid/sid が付いていることを検証する(送信欠落のサイレント回帰防止) */
export function expectAnonIdsPresent(hit: HitRecord): void {
  expectAnonIdentityValues(hit.vid, hit.sid);
  console.log("  ✓ hit.vid / hit.sid 形式OK");
}

/** ヒット1件の payload / ts / ua トークンを検証する */
export function expectHitPayload(
  hit: HitRecord,
  expected: ExpectedHitPayload
): void {
  if (expected.eventId !== undefined && hit.eventId !== expected.eventId) {
    throw assertionError({
      actual: { eventId: hit.eventId },
      expected: { eventId: expected.eventId },
      name: "hit-payload-event-id",
      summary: `hit.eventId が不一致: got=${hit.eventId} want=${expected.eventId}`,
    });
  }
  if (expected.type !== undefined && hit.type !== expected.type) {
    throw assertionError({
      actual: { type: hit.type },
      expected: { type: expected.type },
      name: "hit-payload-type",
      summary: `hit.type が不一致: got=${hit.type} want=${expected.type}`,
    });
  }
  if (
    expected.urlIncludes !== undefined &&
    !hit.url.includes(expected.urlIncludes)
  ) {
    throw assertionError({
      actual: { url: hit.url },
      expected: { urlIncludes: expected.urlIncludes },
      name: "hit-payload-url",
      summary: `hit.url が期待文字列を含まない: actual=${JSON.stringify(hit.url)} expectedSubstring=${JSON.stringify(expected.urlIncludes)}`,
    });
  }
  if (
    expected.workspaceId !== undefined &&
    hit.workspaceId !== expected.workspaceId
  ) {
    throw assertionError({
      actual: { workspaceId: hit.workspaceId },
      expected: { workspaceId: expected.workspaceId },
      name: "hit-payload-workspace-id",
      summary: `hit.workspaceId が不一致: got=${hit.workspaceId} want=${expected.workspaceId}`,
    });
  }
  if (
    expected.uaIncludes !== undefined &&
    !hit.ua.includes(expected.uaIncludes)
  ) {
    throw assertionError({
      actual: { ua: hit.ua },
      expected: { uaIncludes: expected.uaIncludes },
      name: "hit-payload-user-agent",
      summary: `hit.ua が期待文字列を含まない: actual=${JSON.stringify(hit.ua)} expectedSubstring=${JSON.stringify(expected.uaIncludes)}`,
    });
  }
  if (expected.vid !== undefined && hit.vid !== expected.vid) {
    throw assertionError({
      actual: { vid: hit.vid },
      expected: { vid: expected.vid },
      name: "hit-payload-vid",
      summary: `hit.vid が不一致: got=${hit.vid} want=${expected.vid}`,
    });
  }
  if (expected.sid !== undefined && hit.sid !== expected.sid) {
    throw assertionError({
      actual: { sid: hit.sid },
      expected: { sid: expected.sid },
      name: "hit-payload-sid",
      summary: `hit.sid が不一致: got=${hit.sid} want=${expected.sid}`,
    });
  }
  const hitTimestampMs = Date.parse(hit.ts);
  if (
    !Number.isFinite(hitTimestampMs) ||
    new Date(hitTimestampMs).toISOString() !== hit.ts
  ) {
    throw assertionError({
      actual: { timestamp: hit.ts },
      expected: { format: "UTC ISO 8601" },
      name: "hit-payload-timestamp-format",
      summary: `hit.ts が ISO 形式ではない: actual=${JSON.stringify(hit.ts)} expected=UTC ISO 8601（例: 2026-01-01T00:00:00.000Z）`,
    });
  }
  const checkedAtMs = Date.now();
  if (
    hitTimestampMs < E2E_ASSERTIONS_STARTED_AT_MS ||
    hitTimestampMs > checkedAtMs
  ) {
    const timestampRange = {
      from: new Date(E2E_ASSERTIONS_STARTED_AT_MS).toISOString(),
      to: new Date(checkedAtMs).toISOString(),
    };
    throw assertionError({
      actual: { timestamp: hit.ts },
      expected: { range: timestampRange },
      name: "hit-payload-timestamp-range",
      summary: `hit.ts が E2E 実行範囲外: got=${hit.ts} range=${timestampRange.from}..${timestampRange.to}`,
    });
  }
  // ブラウザ由来ヒットは常に形式付きの非空 vid/sid を持つ(送信欠落のサイレント回帰防止)
  expectAnonIdsPresent(hit);
  console.log("  ✓ hit payload 検証OK");
}
