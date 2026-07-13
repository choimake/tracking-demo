import {
  gotoDemoPage,
  simulateExitIntent,
  simulateNonExitMouseout,
} from "../browser/index.js";
import { BEACON_SETTLE_MS, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  quiesceBeacons,
  expectFiredHit,
  expectNoHitsDuringObservation,
} from "../tracking/index.js";

/** 離脱インテントトリガー(非離脱 mouseout は不発・上端外で発火) */
export async function testExitIntentTrigger(ctx: E2eContext): Promise<void> {
  const { exitIntentEventId } = ctx.fixtures;
  await quiesceBeacons(ctx.tracking);
  const exitCountBefore = await ctx.tracking.getEventCount7d(exitIntentEventId);
  await gotoDemoPage(ctx.page, "/");

  // clientY > 0 ガード殺傷: ガード削除変異だとここで発火してしまう
  const nonExitCursor = await ctx.tracking.captureHitCursor();
  await simulateNonExitMouseout(ctx.page);
  await expectNoHitsDuringObservation(
    ctx.tracking,
    {
      afterHitId: nonExitCursor,
      eventId: exitIntentEventId,
      type: "event",
    },
    "非離脱 mouseout の exit_intent",
    { observationMs: BEACON_SETTLE_MS }
  );
  console.log("  ✓ 非離脱 mouseout(clientY>0)では件数不変");

  await expectFiredHit({
    act: async () => simulateExitIntent(ctx.page),
    exactCount: {
      countBefore: exitCountBefore,
      eventId: exitIntentEventId,
      expectedDelta: 1,
      kind: "event-increase",
      label: "離脱インテントイベント +1",
    },
    expectedPayload: {
      eventId: exitIntentEventId,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: exitIntentEventId, type: "event" },
    hitLabel: "離脱インテントヒット取得",
    tracking: ctx.tracking,
  });
}
