import { gotoDemoPage, pushTdDataLayerPageview } from "../browser/index.js";
import {
  BEACON_SETTLE_MS,
  DEDUP_WINDOW_EXCEEDED_WAIT_MS,
  UA_TOKEN,
  WORKSPACE_ID,
  sleep,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  quiesceBeacons,
  waitForCondition,
  expectExactPageviewCountAfterDelay,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** GTM History Change併用(自動検知+手動push): 二重計上なし・1000ms超の再送は許容 */
export async function testGtmHistoryChangeDedup(
  ctx: E2eContext
): Promise<void> {
  const { tracking, page, browserName } = ctx;
  await quiesceBeacons(tracking);
  const purchaseCountBeforeInitial =
    await tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const initialCursor = await tracking.captureHitCursor();
  await gotoDemoPage(page, "/spa");
  // 初期PVの着弾を待ってから、遷移用の Hit カーソルを取得する。
  await waitForCondition(
    "SPA 初期 pageview 着弾",
    async () => (await tracking.getPageviewCountAfter(initialCursor)) >= 1
  );
  const transitionCursor = await tracking.captureHitCursor();

  // GTM の History Change トリガー設置を模す: pushState 直後(同一tick)に
  // tdDataLayer.push({event:'tracker.pageview'}) を発火する。
  // tracker.js 自身の History API 自動検知と手動 push が同一遷移で両方走っても、
  // pageview・URL到達CV(ev_purchase)がそれぞれちょうど+1件であること(二重計上なし)。
  // pushState と push は同一tickで実行する必要があるため、browser/actions を
  // 個別に呼ぶのではなく1回の evaluate にまとめている。
  await page.evaluate(() => {
    history.pushState({}, "", "/order/complete");
    (
      window as unknown as { tdDataLayer?: { push: (i: unknown) => void } }
    ).tdDataLayer?.push({
      event: "tracker.pageview",
    });
  });
  await waitForCondition(
    "自動検知+手動pushの同一遷移: pageview 1件・購入完了 +1件(二重計上なし)",
    async () =>
      (await tracking.getPageviewCountAfter(transitionCursor)) === 1 &&
      (await tracking.getEventCount7d(EVENT_ID_PURCHASE)) ===
        purchaseCountBeforeInitial + 1
  );

  await expectExactPageviewCountAfterDelay(
    tracking,
    transitionCursor,
    1,
    BEACON_SETTLE_MS,
    (actualCount) =>
      `pageview が ${actualCount} 件(期待 1 件。遅延した重複ビーコンによる水増し)`
  );
  const purchaseCountAfterSettle =
    await tracking.getEventCount7d(EVENT_ID_PURCHASE);
  if (purchaseCountAfterSettle !== purchaseCountBeforeInitial + 1) {
    throw new Error(
      `購入完了イベントが ${purchaseCountAfterSettle - purchaseCountBeforeInitial} 件(期待 +1 件。遅延した重複計上)`
    );
  }
  console.log("  ✓ 1500ms後も pageview 1件・購入完了 +1件を維持(遅延着弾なし)");

  const pvHit = await waitForNewHit(
    tracking,
    {
      afterHitId: transitionCursor,
      eventId: null,
      type: "pageview",
    },
    "GTM dedup pageview ヒット取得"
  );
  expectHitPayload(pvHit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[browserName],
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });

  await sleep(DEDUP_WINDOW_EXCEEDED_WAIT_MS);
  const purchaseCountBeforeManualResend =
    await tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const resendCursor = await tracking.captureHitCursor();
  await pushTdDataLayerPageview(page);
  await waitForCondition(
    "1000ms超の手動再送: 新しいpageview 1件・購入完了 +1件として処理される",
    async () =>
      (await tracking.getPageviewCountAfter(resendCursor)) === 1 &&
      (await tracking.getEventCount7d(EVENT_ID_PURCHASE)) ===
        purchaseCountBeforeManualResend + 1
  );

  const resendHit = await waitForNewHit(
    tracking,
    { afterHitId: resendCursor, eventId: null, type: "pageview" },
    "手動再送 pageview ヒット取得"
  );
  expectHitPayload(resendHit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[browserName],
    workspaceId: WORKSPACE_ID,
  });
}
