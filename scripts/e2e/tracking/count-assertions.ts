import {
  BEACON_SETTLE_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
  WAIT_POLL_INTERVAL_MS,
} from "../harness/config.js";
import { assertionError } from "./assertion-formatter.js";
import type { HitFilter, TrackingClient } from "./client.js";
import {
  WaitTimeoutError,
  observeUntilDeadline,
  waitForCondition,
} from "./polling.js";

/** このモジュールは、Hit・pageview・イベントの件数条件を検証する。 */

type HitReader = Pick<TrackingClient, "getHitsMatching">;
type EventCountReader = Pick<TrackingClient, "getEventCount7d">;

interface ObservationOptions {
  observationMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
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
          context: { eventId, label, timeoutDiagnostic: error.message },
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
