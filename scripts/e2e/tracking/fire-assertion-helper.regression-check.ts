import assert from "node:assert/strict";

import type { HitRecord } from "./client.js";
import { expectFiredHit } from "./fire-assertion-helper.js";

function validHit(): HitRecord {
  return {
    eventId: "ev_regression",
    id: "hit-after-act",
    sid: "s_00000000-0000-0000-0000-000000000000",
    test: false,
    ts: new Date().toISOString(),
    type: "event",
    ua: "regression-check",
    url: "http://example.test/complete",
    vid: "v_00000000-0000-0000-0000-000000000000",
    workspaceId: "ws-001",
  };
}

function compileTimeRequiredSteps(): void {
  const tracking = {
    captureHitCursor: async () => undefined,
    getEventCount7d: async () => 1,
    getHitsMatching: async () => [validHit()],
  };

  // @ts-expect-error payload期待値を省略した呼び出しは型エラーにする。
  void expectFiredHit({
    act: async () => undefined,
    exactCount: { expectedCount: 1, kind: "hit-count", label: "1件" },
    filter: { eventId: "ev_regression", type: "event" },
    hitLabel: "payload省略",
    tracking,
  });

  // @ts-expect-error exact count検証を省略した呼び出しは型エラーにする。
  void expectFiredHit({
    act: async () => undefined,
    expectedPayload: { eventId: "ev_regression", type: "event" },
    filter: { eventId: "ev_regression", type: "event" },
    hitLabel: "exact count省略",
    tracking,
  });

  void expectFiredHit({
    act: async () => undefined,
    exactCount: { expectedCount: 1, kind: "hit-count", label: "1件" },
    // @ts-expect-error payload期待値にはHit typeを必須とする。
    expectedPayload: { eventId: "ev_regression" },
    filter: { eventId: "ev_regression", type: "event" },
    hitLabel: "空のpayload検証を拒否",
    tracking,
  });
}
void compileTimeRequiredSteps;

export async function runFireAssertionHelperRegressionCheck(): Promise<void> {
  const calls: string[] = [];
  const hit = validHit();
  const tracking = {
    captureHitCursor: async () => {
      calls.push("cursor");
      return "hit-before-act";
    },
    getEventCount7d: async () => {
      calls.push("exact-count");
      return 1;
    },
    getHitsMatching: async () => {
      calls.push("new-hit");
      return [hit];
    },
  };
  await assert.rejects(
    expectFiredHit({
      act: async () => undefined,
      exactCount: { expectedCount: 0, kind: "hit-count", label: "0件" },
      expectedPayload: { type: "pageview" },
      filter: { eventId: null, type: "pageview" },
      hitLabel: "negativeは対象外",
      tracking,
    }),
    /exact countは1以上/,
    "negative検証を発火helperへ統合しない"
  );
  assert.equal(calls.length, 0);
  const expectedPayload = {
    get eventId() {
      calls.push("payload");
      return "ev_regression";
    },
    type: "event" as const,
  };

  const realDateNow = Date.now;
  const startedAt = realDateNow();
  let dateNowCalls = 0;
  Date.now = () => {
    dateNowCalls += 1;
    return dateNowCalls <= 3 ? startedAt : startedAt + 60_000;
  };
  let result;
  try {
    result = await expectFiredHit({
      act: async () => {
        calls.push("act");
      },
      exactCount: {
        countBefore: 0,
        eventId: "ev_regression",
        expectedDelta: 1,
        kind: "event-increase",
        label: "回帰チェックexact count",
      },
      expectedPayload,
      filter: { eventId: "ev_regression", type: "event" },
      hitLabel: "回帰チェックHit",
      tracking,
    });
  } finally {
    Date.now = realDateNow;
  }

  assert.deepEqual(calls.slice(0, 6), [
    "cursor",
    "act",
    "exact-count",
    "exact-count",
    "new-hit",
    "new-hit",
  ]);
  assert.equal(calls.at(-1), "payload");
  assert.equal(result.hit, hit);
  assert.equal(result.hitCursor, "hit-before-act");
  console.log("fire assertion helper regression check: PASS");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runFireAssertionHelperRegressionCheck();
}
