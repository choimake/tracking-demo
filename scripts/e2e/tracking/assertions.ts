import {
  DEFAULT_WAIT_TIMEOUT_MS,
  BEACON_SETTLE_MS,
  WAIT_POLL_INTERVAL_MS,
  QUIESCE_MAX_WAIT_MS,
  QUIESCE_POLL_INTERVAL_MS,
  QUIESCE_STABLE_DURATION_MS,
  sleep,
} from "../harness/config.js";
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

/** sendBeacon は非同期なので、期待値になるまで最大 timeoutMs ポーリングする */
export async function waitForCondition(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      console.log(`  ✓ ${label}`);
      return;
    }
    await sleep(
      Math.min(WAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))
    );
  }
  throw new Error(
    `✕ FAILED: ${label}: actual=condition false expected=condition true`
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
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  await observe();
}

function assertExactCount(actualCount: number, expectedCount: number): void {
  if (actualCount !== expectedCount) {
    throw new Error(
      `Hit 件数が不一致: got=${actualCount} want=${expectedCount}`
    );
  }
}

function assertZeroCount(actualCount: number): void {
  if (actualCount !== 0) {
    throw new Error(`観測期間中の Hit 件数が不一致: got=${actualCount} want=0`);
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
    await sleep(pollIntervalMs);
    const currentHitIds = await hitIds();
    if (currentHitIds !== previousHitIds) {
      previousHitIds = currentHitIds;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableDurationMs) {
      return;
    }
  }
  throw new Error(
    `ビーコン静穏待ちが ${maxWaitMs}ms で timeout: actual=安定${Date.now() - stableSince}ms expected=安定${stableDurationMs}ms; hitIds=${JSON.stringify(previousHitIds.split("\n").filter(Boolean))}`
  );
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
          throw new Error(
            `イベント件数が期待値を超過: got=${actualCount} want=${expectedCount}`
          );
        }
        return actualCount === expectedCount;
      },
      timeoutMs
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`✕ FAILED: ${label}:`)
    ) {
      throw new Error(
        `イベント件数が期待値へ未到達: got=${lastActualCount ?? "未取得"} want=${expectedCount}`,
        { cause: error }
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
        return lastActualCount >= minCount;
      },
      timeoutMs
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`✕ FAILED: ${label}:`)
    ) {
      throw new Error(
        `Hit 件数が期待値へ未到達: got=${lastActualCount ?? "未取得"} min=${minCount}`,
        { cause: error }
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
        throw new Error(
          `Hit 件数が上限超過: got=${actualCount} max=${maximumCount}`
        );
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
    throw new Error(
      `/api/tag-check の応答に受信済み pageview が含まれない: actualHitIds=${JSON.stringify(tagCheck.hits.map((item) => item.id))} expectedHitId=${hit.id}`
    );
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
      async () =>
        trackerLogs.slice(sinceIndex).some((l) => l.includes(substring)),
      timeoutMs
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`✕ FAILED: ${label}:`)
    ) {
      throw new Error(
        `tracker log が期待文字列を含みません: actual=${JSON.stringify(trackerLogs.slice(sinceIndex))} expectedSubstring=${JSON.stringify(substring)}`,
        { cause: error }
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
    throw new Error(
      `Hit 取得結果が不一致: actual=0件 expected=1件以上; label=${label}`
    );
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

/** ヒットに形式付きの非空 vid/sid が付いていることを検証する(送信欠落のサイレント回帰防止) */
export function expectAnonIdsPresent(hit: HitRecord): void {
  if (!ANON_VID_RE.test(hit.vid)) {
    throw new Error(
      `hit.vid の形式が不正または空: actual=${JSON.stringify(hit.vid)} expected=v_<UUID>（例: v_123e4567-e89b-12d3-a456-426614174000）`
    );
  }
  if (!ANON_SID_RE.test(hit.sid)) {
    throw new Error(
      `hit.sid の形式が不正または空: actual=${JSON.stringify(hit.sid)} expected=s_<UUID>（例: s_123e4567-e89b-12d3-a456-426614174000）`
    );
  }
  console.log("  ✓ hit.vid / hit.sid 形式OK");
}

/** ヒット1件の payload / ts / ua トークンを検証する */
export function expectHitPayload(
  hit: HitRecord,
  expected: ExpectedHitPayload
): void {
  if (expected.eventId !== undefined && hit.eventId !== expected.eventId) {
    throw new Error(
      `hit.eventId が不一致: got=${hit.eventId} want=${expected.eventId}`
    );
  }
  if (expected.type !== undefined && hit.type !== expected.type) {
    throw new Error(`hit.type が不一致: got=${hit.type} want=${expected.type}`);
  }
  if (
    expected.urlIncludes !== undefined &&
    !hit.url.includes(expected.urlIncludes)
  ) {
    throw new Error(
      `hit.url が期待文字列を含まない: actual=${JSON.stringify(hit.url)} expectedSubstring=${JSON.stringify(expected.urlIncludes)}`
    );
  }
  if (
    expected.workspaceId !== undefined &&
    hit.workspaceId !== expected.workspaceId
  ) {
    throw new Error(
      `hit.workspaceId が不一致: got=${hit.workspaceId} want=${expected.workspaceId}`
    );
  }
  if (
    expected.uaIncludes !== undefined &&
    !hit.ua.includes(expected.uaIncludes)
  ) {
    throw new Error(
      `hit.ua が期待文字列を含まない: actual=${JSON.stringify(hit.ua)} expectedSubstring=${JSON.stringify(expected.uaIncludes)}`
    );
  }
  if (expected.vid !== undefined && hit.vid !== expected.vid) {
    throw new Error(`hit.vid が不一致: got=${hit.vid} want=${expected.vid}`);
  }
  if (expected.sid !== undefined && hit.sid !== expected.sid) {
    throw new Error(`hit.sid が不一致: got=${hit.sid} want=${expected.sid}`);
  }
  const hitTimestampMs = Date.parse(hit.ts);
  if (
    !Number.isFinite(hitTimestampMs) ||
    new Date(hitTimestampMs).toISOString() !== hit.ts
  ) {
    throw new Error(
      `hit.ts が ISO 形式ではない: actual=${JSON.stringify(hit.ts)} expected=UTC ISO 8601（例: 2026-01-01T00:00:00.000Z）`
    );
  }
  const checkedAtMs = Date.now();
  if (
    hitTimestampMs < E2E_ASSERTIONS_STARTED_AT_MS ||
    hitTimestampMs > checkedAtMs
  ) {
    throw new Error(
      `hit.ts が E2E 実行範囲外: got=${hit.ts} range=${new Date(E2E_ASSERTIONS_STARTED_AT_MS).toISOString()}..${new Date(checkedAtMs).toISOString()}`
    );
  }
  // ブラウザ由来ヒットは常に形式付きの非空 vid/sid を持つ(送信欠落のサイレント回帰防止)
  expectAnonIdsPresent(hit);
  console.log("  ✓ hit payload 検証OK");
}
