import { gotoDemoPage } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  expectFiredHit,
  quiesceBeacons,
} from "../tracking/index.js";

/** URL到達トリガー(MPA遷移) */
export async function testUrlReachTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  await expectFiredHit({
    act: async () => gotoDemoPage(ctx.page, "/order/complete"),
    exactCount: {
      countBefore: purchaseCountBefore,
      eventId: EVENT_ID_PURCHASE,
      expectedDelta: 1,
      kind: "event-increase",
      label: "購入完了イベント +1",
    },
    expectedPayload: {
      eventId: EVENT_ID_PURCHASE,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/order/complete",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: EVENT_ID_PURCHASE, type: "event" },
    hitLabel: "購入完了ヒット取得",
    tracking: ctx.tracking,
  });
}
