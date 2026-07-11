import {
  gotoDemoPage,
  simulateExitIntent,
  simulateNonExitMouseout,
} from "../browser/index.js";
import { BEACON_SETTLE_MS, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_EXIT_INTENT,
  quiesceBeacons,
  expectEventCountExactlyIncreasedBy,
  expectNoHitsDuringObservation,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** 離脱インテントトリガー(非離脱 mouseout は不発・上端外で発火) */
export async function testExitIntentTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const exitCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_EXIT_INTENT);
  await gotoDemoPage(ctx.page, "/");

  // clientY > 0 ガード殺傷: ガード削除変異だとここで発火してしまう
  const nonExitCursor = await ctx.tracking.captureHitCursor();
  await simulateNonExitMouseout(ctx.page);
  await expectNoHitsDuringObservation(
    ctx.tracking,
    {
      afterHitId: nonExitCursor,
      eventId: EVENT_ID_EXIT_INTENT,
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
    EVENT_ID_EXIT_INTENT,
    exitCountBefore,
    1,
    "離脱インテントイベント +1"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: EVENT_ID_EXIT_INTENT, type: "event" },
    "離脱インテントヒット取得"
  );
  expectHitPayload(hit, {
    eventId: EVENT_ID_EXIT_INTENT,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/",
    workspaceId: WORKSPACE_ID,
  });
}
