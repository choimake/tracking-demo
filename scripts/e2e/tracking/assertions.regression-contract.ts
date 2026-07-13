import assert from "node:assert/strict";

import type { HitRecord } from "./client.js";

type AssertionsApi = Pick<
  typeof import("./index.js"),
  | "expectAnonIdsPresent"
  | "expectEventCountExactlyIncreasedBy"
  | "expectHitCountAtLeast"
  | "expectHitCountAtMost"
  | "expectHitCountExactly"
  | "expectNoHitsDuringObservation"
  | "expectTagCheckContainsHit"
  | "quiesceBeacons"
  | "waitForCondition"
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
  await assert.rejects(
    assertions.waitForCondition(
      "pageviewCount === 1",
      async () => ({ actual: { pageviewCount: 0 }, ready: false }),
      10
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("condition=pageviewCount === 1") &&
      error.message.includes('finalObserved={"pageviewCount":0}'),
    "timeoutは未成立条件と最終観測値を報告する"
  );

  const excessiveEventCount = { getEventCount7d: async () => 2 };
  await assert.rejects(
    assertions.expectEventCountExactlyIncreasedBy(
      excessiveEventCount,
      "ev_purchase",
      0,
      1,
      "到達待ち途中の超過",
      20
    ),
    // 件数超過時の実際値と期待値へマッチする。例: `イベント件数が期待値を超過: got=2 want=1`。
    /イベント件数が期待値を超過: got=2 want=1/,
    "到達待ち途中に期待件数を超過した場合は失敗する"
  );

  const twoHits = { getHitsMatching: async () => [hit("1"), hit("2")] };
  await assert.rejects(
    assertions.expectHitCountExactly(twoHits, {}, 1, "1件期待", {
      observationMs: 10,
      pollIntervalMs: 2,
      timeoutMs: 10,
    }),
    // exact件数不一致の実際値と期待値へマッチする。例: `Hit 件数が不一致: got=2 want=1`。
    /got=2 want=1/,
    "1件期待へ2件投入した場合は失敗する"
  );
  await assert.rejects(
    assertions.expectHitCountAtMost(twoHits, {}, 1, "最大1件", {
      observationMs: 10,
      pollIntervalMs: 2,
    }),
    // 最大件数超過の診断へマッチする。例: `Hit 件数が上限超過: got=2 max=1`。
    /上限超過/,
    "最大件数を超えた場合は失敗する"
  );

  const noHits = { getHitsMatching: async () => [] };
  await assert.rejects(
    assertions.expectHitCountAtLeast(noHits, {}, 1, "1件待機", 10),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("got=0") &&
      error.message.includes("min=1"),
    "最低件数への未到達は実際値と期待値を報告する"
  );

  await assert.rejects(
    assertions.expectTagCheckContainsHit(
      { getTagCheck: async () => ({ count: 1, hits: [hit("actual")] }) },
      hit("expected")
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('actualHitIds=["actual"]') &&
      error.message.includes("expectedHitId=expected"),
    "tag-check不一致は実際のIDと期待IDを報告する"
  );

  assert.throws(
    () => assertions.expectAnonIdsPresent({ ...hit("invalid-vid"), vid: "" }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('actual=""') &&
      error.message.includes("expected=v_<UUID>"),
    "匿名ID不正は実際値と期待形式を報告する"
  );

  const observationStartedAt = Date.now();
  const lateHitReader = {
    getHitsMatching: async () =>
      Date.now() - observationStartedAt >= 80 ? [hit("late")] : [],
  };
  await assert.rejects(
    assertions.expectNoHitsDuringObservation(
      lateHitReader,
      {},
      "観測窓末尾のHit",
      { observationMs: 100, pollIntervalMs: 10 }
    ),
    // 0件期待への違反診断へマッチする。例: `観測期間中の Hit 件数が不一致: got=1 want=0`。
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
    // ビーコン静穏待ちの期限超過診断へマッチする。例: `ビーコン静穏待ちが 35ms で timeout`。
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
