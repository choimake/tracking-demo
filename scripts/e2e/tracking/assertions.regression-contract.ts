import assert from "node:assert/strict";

import type { HitRecord } from "./client.js";

type AssertionsApi = Pick<
  typeof import("./assertions.js"),
  | "expectHitCountAtMost"
  | "expectHitCountExactly"
  | "expectNoHitsDuringObservation"
  | "quiesceBeacons"
>;

const hit = (id: string): HitRecord => ({
  eventId: null,
  id,
  sid: "s_00000000-0000-0000-0000-000000000000",
  test: false,
  ts: "2026-01-01T00:00:00.000Z",
  type: "pageview",
  ua: "regression-check",
  url: "/",
  vid: "v_00000000-0000-0000-0000-000000000000",
  workspaceId: "ws-001",
});

export async function runAssertionsRegressionContract(
  assertions: AssertionsApi
): Promise<void> {
  const twoHits = { getHitsMatching: async () => [hit("1"), hit("2")] };
  await assert.rejects(
    assertions.expectHitCountExactly(twoHits, {}, 1, "1件期待", {
      observationMs: 10,
      pollIntervalMs: 2,
      timeoutMs: 10,
    }),
    /got=2 want=1/,
    "1件期待へ2件投入した場合は失敗する"
  );
  await assert.rejects(
    assertions.expectHitCountAtMost(twoHits, {}, 1, "最大1件", {
      observationMs: 10,
      pollIntervalMs: 2,
    }),
    /上限超過/,
    "最大件数を超えた場合は失敗する"
  );

  const observationStartedAt = Date.now();
  const lateHitReader = {
    getHitsMatching: async () =>
      Date.now() - observationStartedAt >= 35 ? [hit("late")] : [],
  };
  await assert.rejects(
    assertions.expectNoHitsDuringObservation(
      lateHitReader,
      {},
      "観測窓末尾のHit",
      { observationMs: 40, pollIntervalMs: 5 }
    ),
    /観測期間中/,
    "観測窓の末尾直前に投入したHitを検出する"
  );

  let revision = 0;
  const changingReader = {
    getHitsMatching: async () => [hit(String(revision++))],
  };
  await assert.rejects(
    assertions.quiesceBeacons(changingReader, {
      maxWaitMs: 35,
      pollIntervalMs: 5,
      stableDurationMs: 15,
    }),
    /timeout/,
    "静穏が成立しない場合は失敗する"
  );

  const stableReader = { getHitsMatching: async () => [hit("stable")] };
  await assertions.quiesceBeacons(stableReader, {
    maxWaitMs: 50,
    pollIntervalMs: 5,
    stableDurationMs: 15,
  });
}
