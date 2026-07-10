import { gotoDemoPage, clickAddToCart } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_CART,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** クリックトリガー(CSSセレクタ) */
export async function testClickTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const cartCountBefore = await ctx.tracking.getEventCount7d(EVENT_ID_CART);
  const sinceMs = Date.now();
  await gotoDemoPage(ctx.page, "/products");
  await clickAddToCart(ctx.page);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_CART,
    cartCountBefore,
    1,
    "カート追加イベント +1"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { eventId: EVENT_ID_CART, sinceMs, type: "event" },
    "カート追加ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: EVENT_ID_CART,
    sinceMs,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: "/products",
    workspaceId: WORKSPACE_ID,
  });
}
