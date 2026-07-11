import {
  DEFAULT_WAIT_TIMEOUT_MS,
  WAIT_POLL_INTERVAL_MS,
  QUIESCE_MAX_WAIT_MS,
  QUIESCE_POLL_INTERVAL_MS,
  QUIESCE_STABLE_DURATION_MS,
} from "../harness/config.js";
import type { HitFilter, HitRecord, TrackingClient } from "./client.js";

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
  throw new Error(`✕ FAILED: ${label}`);
}

/**
 * ビーコン静穏待ち: 直前のテストで送信された遅延ビーコンが着弾しきるまで待つ。
 * イベント件数と pageview 件数の合計が約1秒間変化しなくなったら静穏とみなす
 * (countBefore / pageviewSinceMs 取得のフレーキー防止)
 */
export async function quiesceBeacons(tracking: TrackingClient): Promise<void> {
  const sumCounts = async () =>
    (await tracking.getEventSummaries()).reduce(
      (total, e) => total + e.count7d,
      0
    ) + (await tracking.getPageviewCountSince(0));
  const deadline = Date.now() + QUIESCE_MAX_WAIT_MS;
  let previousSum = await sumCounts();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(QUIESCE_POLL_INTERVAL_MS);
    const currentSum = await sumCounts();
    if (currentSum !== previousSum) {
      previousSum = currentSum;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= QUIESCE_STABLE_DURATION_MS) {
      return;
    }
  }
}

export async function expectEventCountIncreasedBy(
  tracking: TrackingClient,
  eventId: string,
  countBefore: number,
  expectedDelta: number,
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  await waitForCondition(
    label,
    async () =>
      (await tracking.getEventCount7d(eventId)) === countBefore + expectedDelta,
    timeoutMs
  );
}

export async function expectPageviewCountSince(
  tracking: TrackingClient,
  pageviewSinceMs: number,
  minCount: number,
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  await waitForCondition(
    label,
    async () =>
      (await tracking.getPageviewCountSince(pageviewSinceMs)) >= minCount,
    timeoutMs
  );
}

/** 猶予(delayMs)を空けてから pageview 件数がちょうど expectedCount 件であることを確認する */
export async function expectExactPageviewCountAfterDelay(
  tracking: TrackingClient,
  pageviewSinceMs: number,
  expectedCount: number,
  delayMs: number,
  mismatchMessage: (actualCount: number) => string
): Promise<void> {
  await sleep(delayMs);
  const actualCount = await tracking.getPageviewCountSince(pageviewSinceMs);
  if (actualCount !== expectedCount) {
    throw new Error(mismatchMessage(actualCount));
  }
}

/** 猶予(delayMs)を空けてから、イベント件数(7日間)がちょうど expectedCount 件であることを確認する */
export async function expectExactEventCountAfterDelay(
  tracking: TrackingClient,
  eventId: string,
  expectedCount: number,
  delayMs: number,
  mismatchMessage: (actualCount: number) => string
): Promise<void> {
  await sleep(delayMs);
  const actualCount = await tracking.getEventCount7d(eventId);
  if (actualCount !== expectedCount) {
    throw new Error(mismatchMessage(actualCount));
  }
}

export async function expectTrackerLogContains(
  trackerLogs: string[],
  substring: string,
  label: string,
  sinceIndex = 0,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  await waitForCondition(
    label,
    async () =>
      trackerLogs.slice(sinceIndex).some((l) => l.includes(substring)),
    timeoutMs
  );
}

/**
 * sinceMs 以降に着弾したヒットを待つ。件数アサーションのあとに呼び、
 * ヒット単位の payload / ts / ua 検証に使う
 */
export async function waitForNewHit(
  tracking: TrackingClient,
  filter: HitFilter & { sinceMs: number },
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<HitRecord> {
  let found: HitRecord | undefined;
  await waitForCondition(
    label,
    async () => {
      const hits = await tracking.getHitsMatching(filter);
      found = hits.at(-1);
      return !!found;
    },
    timeoutMs
  );
  if (!found) {
    throw new Error(`✕ FAILED: ${label} (ヒットなし)`);
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
  sinceMs?: number;
  untilMs?: number;
}

/** 匿名 vid (`v_` + UUID) の形式。tracker / server と同じ */
export const ANON_VID_RE = /^v_[0-9a-f-]{36}$/;
/** 匿名 sid (`s_` + UUID) の形式。tracker / server と同じ */
export const ANON_SID_RE = /^s_[0-9a-f-]{36}$/;

/** ヒットに形式付きの非空 vid/sid が付いていることを検証する(送信欠落のサイレント回帰防止) */
export function expectAnonIdsPresent(hit: HitRecord): void {
  if (!ANON_VID_RE.test(hit.vid)) {
    throw new Error(`hit.vid の形式が不正または空: ${hit.vid}`);
  }
  if (!ANON_SID_RE.test(hit.sid)) {
    throw new Error(`hit.sid の形式が不正または空: ${hit.sid}`);
  }
  console.log("  ✓ hit.vid / hit.sid 形式OK");
}

/** ヒット1件の payload / ts 窓 / ua トークンを検証する */
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
      `hit.url に "${expected.urlIncludes}" が含まれない: ${hit.url}`
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
      `hit.ua に "${expected.uaIncludes}" が含まれない: ${hit.ua}`
    );
  }
  if (expected.vid !== undefined && hit.vid !== expected.vid) {
    throw new Error(`hit.vid が不一致: got=${hit.vid} want=${expected.vid}`);
  }
  if (expected.sid !== undefined && hit.sid !== expected.sid) {
    throw new Error(`hit.sid が不一致: got=${hit.sid} want=${expected.sid}`);
  }
  const hitMs = new Date(hit.ts).getTime();
  if (expected.sinceMs !== undefined && hitMs < expected.sinceMs) {
    throw new Error(
      `hit.ts が sinceMs より前: ts=${hit.ts} sinceMs=${expected.sinceMs}`
    );
  }
  if (expected.untilMs !== undefined && hitMs > expected.untilMs) {
    throw new Error(
      `hit.ts が untilMs より後: ts=${hit.ts} untilMs=${expected.untilMs}`
    );
  }
  // ブラウザ由来ヒットは常に形式付きの非空 vid/sid を持つ(送信欠落のサイレント回帰防止)
  expectAnonIdsPresent(hit);
  console.log("  ✓ hit payload 検証OK");
}
