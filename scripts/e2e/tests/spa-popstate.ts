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
  expectEventCountExactly,
  expectFiredHit,
} from "../tracking/index.js";

/**
 * SPA popstate(戻る): リロードなしで戻り、戻ったパスの pageview がもう1件着弾する。
 * 「戻る」操作だけでは購入完了イベントは増えない(注文完了到達時の+1のみ)
 */
export async function testSpaPopstate(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  await expectFiredHit({
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
      label: "SPA遷移(注文完了)で購入完了イベント +1",
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

  // 「戻る」操作: リロードを伴わない popstate 経由の疑似遷移になっているか
  await expectFiredHit({
    act: async () => {
      await ctx.page.goBack();
    },
    exactCount: {
      expectedCount: 1,
      kind: "hit-count",
      label: "戻る操作の pageview",
    },
    expectedPayload: {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/spa",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: null, type: "pageview" },
    hitLabel: "戻る操作(popstate)でのpageview再送ヒット取得",
    tracking: ctx.tracking,
  });

  const marker = await getNoReloadMarker(ctx.page);
  if (marker !== 1) {
    throw new Error(
      "戻る操作でページがリロードされている(popstateでの疑似遷移になっていない)"
    );
  }
  console.log("  ✓ 戻る操作でリロードなし(popstate)を確認");

  await expectEventCountExactly(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    purchaseCountBefore + 1,
    "戻る操作後の購入完了イベント"
  );
  console.log("  ✓ 戻る操作だけでは購入完了イベントが増えないことを確認");
}
