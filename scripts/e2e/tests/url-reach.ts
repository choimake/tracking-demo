import { gotoDemoPage } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** URL到達トリガー(MPA遷移) */
export async function testUrlReachTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/order/complete");
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    purchaseCountBefore,
    1,
    "購入完了イベント +1"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: EVENT_ID_PURCHASE, type: "event" },
    "購入完了ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: EVENT_ID_PURCHASE,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });
}
