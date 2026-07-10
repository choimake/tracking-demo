import { gotoDemoPage, simulateExitIntent } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_EXIT_INTENT,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** 離脱インテントトリガー */
export async function testExitIntentTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const exitCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_EXIT_INTENT);
  const sinceMs = Date.now();
  await gotoDemoPage(ctx.page, "/");
  await simulateExitIntent(ctx.page);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_EXIT_INTENT,
    exitCountBefore,
    1,
    "離脱インテントイベント +1"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { eventId: EVENT_ID_EXIT_INTENT, sinceMs, type: "event" },
    "離脱インテントヒット取得"
  );
  expectHitPayload(hit, {
    eventId: EVENT_ID_EXIT_INTENT,
    sinceMs,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: "/",
    workspaceId: WORKSPACE_ID,
  });
}
