import {
  gotoDemoPage,
  simulateExitIntent,
  simulateNonExitMouseout,
} from "../browser/index.js";
import { BEACON_SETTLE_MS, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  quiesceBeacons,
  expectEventCountExactlyIncreasedBy,
  expectNoHitsDuringObservation,
  waitForNewHit,
  expectHitPayload,
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

  const hitCursor = await ctx.tracking.captureHitCursor();
  await simulateExitIntent(ctx.page);
  await expectEventCountExactlyIncreasedBy(
    ctx.tracking,
    exitIntentEventId,
    exitCountBefore,
    1,
    "離脱インテントイベント +1"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: exitIntentEventId, type: "event" },
    "離脱インテントヒット取得"
  );
  expectHitPayload(hit, {
    eventId: exitIntentEventId,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/",
    workspaceId: WORKSPACE_ID,
  });
}
