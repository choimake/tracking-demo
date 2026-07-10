import {
  gotoDemoPage,
  clickSpaOrderComplete,
  setNoReloadMarker,
  getNoReloadMarker,
} from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  expectPageviewCountSince,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** SPA対応: History Change でページビュー再評価 + URL到達発火 */
export async function testSpaHistoryChange(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const sinceMs = Date.now();
  await gotoDemoPage(ctx.page, "/spa");
  await setNoReloadMarker(ctx.page);
  await clickSpaOrderComplete(ctx.page);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    purchaseCountBefore,
    1,
    "SPA遷移で購入完了イベント +1"
  );
  await expectPageviewCountSince(
    ctx.tracking,
    sinceMs,
    2,
    "SPA遷移でページビューも送信(初回PV + 遷移PV = 2件)"
  );
  const marker = await getNoReloadMarker(ctx.page);
  if (marker !== 1) {
    throw new Error("ページがリロードされている(SPA遷移になっていない)");
  }
  console.log("  ✓ リロードなし(pushState遷移)を確認");

  const purchaseHit = await waitForNewHit(
    ctx.tracking,
    { eventId: EVENT_ID_PURCHASE, sinceMs, type: "event" },
    "SPA購入完了ヒット取得"
  );
  expectHitPayload(purchaseHit, {
    eventId: EVENT_ID_PURCHASE,
    sinceMs,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });

  const pageviewHits = await ctx.tracking.getPageviewHitsSince(sinceMs);
  if (pageviewHits.length < 2) {
    throw new Error(
      `pageview ヒットが ${pageviewHits.length} 件(期待 2 件以上)`
    );
  }
  const lastPv = pageviewHits.at(-1)!;
  expectHitPayload(lastPv, {
    eventId: null,
    sinceMs,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });
}
