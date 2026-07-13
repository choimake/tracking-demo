import { gotoDemoPage, clickAddToCartChild } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_CART,
  expectFiredHit,
  quiesceBeacons,
} from "../tracking/index.js";

/** クリックトリガー(CSSセレクタ・子要素クリックで closest 委譲を検証) */
export async function testClickTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const cartCountBefore = await ctx.tracking.getEventCount7d(EVENT_ID_CART);
  await expectFiredHit({
    act: async () => {
      await gotoDemoPage(ctx.page, "/products");
      // closest('.add-to-cart') なら発火、matches 変異なら未発火
      await clickAddToCartChild(ctx.page);
    },
    exactCount: {
      countBefore: cartCountBefore,
      eventId: EVENT_ID_CART,
      expectedDelta: 1,
      kind: "event-increase",
      label: "カート追加イベント +1",
    },
    expectedPayload: {
      eventId: EVENT_ID_CART,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/products",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: EVENT_ID_CART, type: "event" },
    hitLabel: "カート追加ヒット取得",
    tracking: ctx.tracking,
  });
}
