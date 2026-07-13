import {
  gotoDemoPage,
  clickSpaOrderComplete,
  setNoReloadMarker,
  getNoReloadMarker,
  spaReplaceStateSamePath,
} from "../browser/index.js";
import { BEACON_SETTLE_MS, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  expectFiredHit,
  expectHitPayload,
  expectNoHitsDuringObservation,
  expectPageviewCountExactly,
  quiesceBeacons,
} from "../tracking/index.js";

/** SPA対応: History Change でページビュー再評価 + URL到達発火 */
export async function testSpaHistoryChange(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const { hitCursor } = await expectFiredHit({
    act: async () => {
      await gotoDemoPage(ctx.page, "/spa");
      await setNoReloadMarker(ctx.page);
      await clickSpaOrderComplete(ctx.page);
    },
    exactCount: {
      countBefore: purchaseCountBefore,
      eventId: EVENT_ID_PURCHASE,
      expectedDelta: 1,
      kind: "event-increase",
      label: "SPA遷移で購入完了イベント +1",
    },
    expectedPayload: {
      eventId: EVENT_ID_PURCHASE,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/order/complete",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: EVENT_ID_PURCHASE, type: "event" },
    hitLabel: "SPA購入完了ヒット取得",
    tracking: ctx.tracking,
  });
  await expectPageviewCountExactly(
    ctx.tracking,
    hitCursor,
    2,
    "SPA遷移でページビューも送信(初回PV + 遷移PV = 2件)"
  );
  const marker = await getNoReloadMarker(ctx.page);
  if (marker !== 1) {
    throw new Error("ページがリロードされている(SPA遷移になっていない)");
  }
  console.log("  ✓ リロードなし(pushState遷移)を確認");

  const pageviewHits = await ctx.tracking.getPageviewHitsAfter(hitCursor);
  if (pageviewHits.length < 2) {
    throw new Error(
      `pageview ヒットが ${pageviewHits.length} 件(期待 2 件以上)`
    );
  }
  const lastPv = pageviewHits.at(-1)!;
  expectHitPayload(lastPv, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });

  // 同一パス replaceState: 早期 return があれば追加 PV なし、削除変異なら +1
  const samePathCursor = await ctx.tracking.captureHitCursor();
  await spaReplaceStateSamePath(ctx.page);
  await expectNoHitsDuringObservation(
    ctx.tracking,
    { afterHitId: samePathCursor, eventId: null, type: "pageview" },
    "同一パス replaceState の追加 pageview",
    { observationMs: BEACON_SETTLE_MS }
  );
  console.log("  ✓ 同一パス replaceState では追加 pageview なし");
}
