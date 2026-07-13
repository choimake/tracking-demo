import {
  DEFAULT_WAIT_TIMEOUT_MS,
  QUIESCE_MAX_WAIT_MS,
  QUIESCE_POLL_INTERVAL_MS,
  QUIESCE_STABLE_DURATION_MS,
  WAIT_POLL_INTERVAL_MS,
  registeredWait,
} from "../harness/config.js";
import {
  assertionError,
  formatAssertionFailure,
} from "./assertion-formatter.js";
import type { TrackingClient } from "./client.js";

/** このモジュールは、条件成立・観測期限・ビーコン静穏の再観測を管理する。 */

type HitReader = Pick<TrackingClient, "getHitsMatching">;

interface QuiesceOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  stableDurationMs?: number;
}

export interface WaitObservation<T> {
  actual: T;
  ready: boolean;
}

export class WaitTimeoutError extends Error {}

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

export async function observeUntilDeadline(
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

/** 相関する Hit ID 列が一定期間変化しないことを確認する。 */
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
