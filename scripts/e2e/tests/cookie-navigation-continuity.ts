import {
  clickSpaOrderComplete,
  getNoReloadMarker,
  gotoDemoPage,
  setNoReloadMarker,
} from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  expectEventCountExactlyIncreasedBy,
  expectHitPayload,
  expectPageviewCountExactly,
  quiesceBeacons,
  waitForNewHit,
} from "../tracking/index.js";
import {
  assertPageviewIdentity,
  visitAndGetPageview,
} from "./cookie-helpers.js";

export async function testCookieNavigationContinuity(
  ctx: E2eContext
): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  await ctx.page.context().clearCookies();
  const first = await visitAndGetPageview(ctx, "/");
  const mpa = await visitAndGetPageview(ctx, "/products");
  assertPageviewIdentity(ctx, mpa, {
    path: "/products",
    sid: first.sid,
    vid: first.vid,
  });

  const count = await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const cursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/spa");
  await setNoReloadMarker(ctx.page);
  await clickSpaOrderComplete(ctx.page);
  await expectEventCountExactlyIncreasedBy(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    count,
    1,
    "SPA購入 +1"
  );
  await expectPageviewCountExactly(
    ctx.tracking,
    cursor,
    2,
    "SPA初回と/order/complete遷移のpageview"
  );
  if ((await getNoReloadMarker(ctx.page)) !== 1)
    throw new Error("SPA遷移でreloadした");
  const purchaseHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: cursor, eventId: EVENT_ID_PURCHASE, type: "event" },
    "SPA購入Hit"
  );
  expectHitPayload(purchaseHit, {
    eventId: EVENT_ID_PURCHASE,
    sid: first.sid,
    type: "event",
    urlIncludes: "/order/complete",
    vid: first.vid,
  });

  const pageviews = await ctx.tracking.getHitsMatching({
    afterHitId: cursor,
    eventId: null,
    type: "pageview",
  });
  const completedPageviews = pageviews.filter((hit) =>
    hit.url.includes("/order/complete")
  );
  if (completedPageviews.length !== 1) {
    throw new Error(
      `SPA遷移後pageviewが正確に1件ではない: ${completedPageviews.length}`
    );
  }
  assertPageviewIdentity(ctx, completedPageviews[0], {
    path: "/order/complete",
    sid: first.sid,
    vid: first.vid,
  });
}
