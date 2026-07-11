import { gotoDemoPage, clickAddToCartChild } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_CART,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** クリックトリガー(CSSセレクタ・子要素クリックで closest 委譲を検証) */
export async function testClickTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const cartCountBefore = await ctx.tracking.getEventCount7d(EVENT_ID_CART);
  const hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/products");
  // closest('.add-to-cart') なら発火、matches 変異なら未発火
  await clickAddToCartChild(ctx.page);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_CART,
    cartCountBefore,
    1,
    "カート追加イベント +1"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: EVENT_ID_CART, type: "event" },
    "カート追加ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: EVENT_ID_CART,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/products",
    workspaceId: WORKSPACE_ID,
  });
}
