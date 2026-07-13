import {
  clickSpaOrderComplete,
  getNoReloadMarker,
  gotoDemoPage,
  setNoReloadMarker,
} from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  expectFiredHit,
  expectPageviewCountExactly,
  quiesceBeacons,
} from "../tracking/index.js";
import {
  assertPageviewIdentity,
  visitAndGetPageview,
} from "./cookie-helpers.js";

export async function testCookieNavigationContinuity(
  ctx: E2eContext
): Promise<void> {
  await ctx.clearCookies();
  const first = await visitAndGetPageview(ctx, "/");
  const mpa = await visitAndGetPageview(ctx, "/products");
  assertPageviewIdentity(ctx, mpa, {
    path: "/products",
    sid: first.sid,
    vid: first.vid,
  });

  await quiesceBeacons(ctx.tracking);
  const count = await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const { hitCursor: cursor } = await expectFiredHit({
    act: async () => {
      await gotoDemoPage(ctx.page, "/spa");
      await setNoReloadMarker(ctx.page);
      await clickSpaOrderComplete(ctx.page);
    },
    exactCount: {
      countBefore: count,
      eventId: EVENT_ID_PURCHASE,
      expectedDelta: 1,
      kind: "event-increase",
      label: "SPA購入 +1",
    },
    expectedPayload: {
      eventId: EVENT_ID_PURCHASE,
      sid: first.sid,
      type: "event",
      urlIncludes: "/order/complete",
      vid: first.vid,
    },
    filter: { eventId: EVENT_ID_PURCHASE, type: "event" },
    hitLabel: "SPA購入Hit",
    tracking: ctx.tracking,
  });
  await expectPageviewCountExactly(
    ctx.tracking,
    cursor,
    2,
    "SPA初回と/order/complete遷移のpageview"
  );
  const latestPageview = (await ctx.tracking.getPageviewHitsAfter(cursor)).at(
    -1
  );
  if (!latestPageview) throw new Error("SPA購入完了pageview Hitを取得できない");
  assertPageviewIdentity(ctx, latestPageview, {
    path: "/order/complete",
    sid: first.sid,
    vid: first.vid,
  });
  if ((await getNoReloadMarker(ctx.page)) !== 1)
    throw new Error("SPA遷移でreloadした");
  const pageviews = await ctx.tracking.getHitsMatching({
    afterHitId: cursor,
    eventId: null,
    type: "pageview",
  });
  const initialSpaPageviews = pageviews.filter(
    (hit) => new URL(hit.url).pathname === "/spa"
  );
  const completedPageviews = pageviews.filter((hit) =>
    hit.url.includes("/order/complete")
  );
  if (initialSpaPageviews.length !== 1 || completedPageviews.length !== 1) {
    throw new Error(
      `SPA区間のpageview内訳が不正: /spa=${initialSpaPageviews.length} /order/complete=${completedPageviews.length}`
    );
  }
  assertPageviewIdentity(ctx, initialSpaPageviews[0], {
    path: "/spa",
    sid: first.sid,
    vid: first.vid,
  });
  assertPageviewIdentity(ctx, completedPageviews[0], {
    path: "/order/complete",
    sid: first.sid,
    vid: first.vid,
  });
}
