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
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/**
 * SPA popstate(戻る): リロードなしで戻り、戻ったパスの pageview がもう1件着弾する。
 * 「戻る」操作だけでは購入完了イベントは増えない(注文完了到達時の+1のみ)
 */
export async function testSpaPopstate(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const purchaseCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/spa");
  await setNoReloadMarker(ctx.page);
  await clickSpaOrderComplete(ctx.page);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    purchaseCountBefore,
    1,
    "SPA遷移(注文完了)で購入完了イベント +1"
  );
  const purchaseHit = await waitForNewHit(
    ctx.tracking,
    {
      afterHitId: purchaseCursor,
      eventId: EVENT_ID_PURCHASE,
      type: "event",
    },
    "SPA購入完了ヒット取得"
  );
  expectHitPayload(purchaseHit, {
    eventId: EVENT_ID_PURCHASE,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });

  // 「戻る」操作: リロードを伴わない popstate 経由の疑似遷移になっているか
  const backCursor = await ctx.tracking.captureHitCursor();
  await ctx.page.goBack();
  const backHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: backCursor, eventId: null, type: "pageview" },
    "戻る操作(popstate)でのpageview再送ヒット取得"
  );
  expectHitPayload(backHit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/spa",
    workspaceId: WORKSPACE_ID,
  });

  const marker = await getNoReloadMarker(ctx.page);
  if (marker !== 1) {
    throw new Error(
      "戻る操作でページがリロードされている(popstateでの疑似遷移になっていない)"
    );
  }
  console.log("  ✓ 戻る操作でリロードなし(popstate)を確認");

  const purchaseCountAfterBack =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  if (purchaseCountAfterBack !== purchaseCountBefore + 1) {
    throw new Error(
      `戻る操作だけで購入完了イベントが ${purchaseCountAfterBack - purchaseCountBefore} 件(期待 +1 件のまま。戻るだけでの誤発火)`
    );
  }
  console.log("  ✓ 戻る操作だけでは購入完了イベントが増えないことを確認");
}
