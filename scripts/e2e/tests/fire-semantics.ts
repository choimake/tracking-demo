import {
  gotoDemoPage,
  clickAddToCart,
  scrollToBottom,
  scrollToTop,
} from "../browser/index.js";
import { BEACON_SETTLE_MS, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext, HitRecord } from "../harness/types.js";
import {
  EVENT_ID_CART,
  EVENT_ID_SCROLL_50,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  expectExactEventCountAfterDelay,
  waitForCondition,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/**
 * 発火回数の意味論:
 * - クリックトリガーは fire() であり、1PV内でクリックした回数だけ毎回発火する
 * - スクロール率トリガーは fireOnce() であり、1PV内では閾値到達後の再スクロールでも
 *   再発火しない(最下部→先頭→再最下部でも +1 のまま)
 */
export async function testFireSemantics(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const cartCountBefore = await ctx.tracking.getEventCount7d(EVENT_ID_CART);
  const scrollCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_SCROLL_50);
  const hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/products");

  // --- クリック: 2回押して +2(fire、1PV内で複数回発火を許容) ---
  await clickAddToCart(ctx.page);
  await clickAddToCart(ctx.page);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_CART,
    cartCountBefore,
    2,
    "カート追加ボタンを2回クリックしてイベントが+2件(クリックは複数回発火)"
  );
  // db.json への書き込みは非同期debounceのため、件数APIで+2を確認済みでも
  // ヒットの直接読み取り(getHitsMatching)は着弾までポーリングで待つ必要がある
  let cartHits: HitRecord[] = [];
  await waitForCondition("カート追加ヒットが2件着弾", async () => {
    cartHits = await ctx.tracking.getHitsMatching({
      afterHitId: hitCursor,
      eventId: EVENT_ID_CART,
      type: "event",
    });
    return cartHits.length >= 2;
  });
  expectHitPayload(cartHits.at(-1)!, {
    eventId: EVENT_ID_CART,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/products",
    workspaceId: WORKSPACE_ID,
  });
  console.log("  ✓ クリックは押した回数だけ発火(fire)することを確認");

  // --- スクロール: 最下部→先頭→再最下部でも +1 のまま(fireOnce、同一PV内では再発火なし) ---
  await scrollToBottom(ctx.page);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_SCROLL_50,
    scrollCountBefore,
    1,
    "最下部スクロールでスクロール50%イベント+1"
  );
  const scrollHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: EVENT_ID_SCROLL_50, type: "event" },
    "スクロール50%ヒット取得"
  );
  expectHitPayload(scrollHit, {
    eventId: EVENT_ID_SCROLL_50,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/products",
    workspaceId: WORKSPACE_ID,
  });

  await scrollToTop(ctx.page);
  await scrollToBottom(ctx.page);
  await expectExactEventCountAfterDelay(
    ctx.tracking,
    EVENT_ID_SCROLL_50,
    scrollCountBefore + 1,
    BEACON_SETTLE_MS,
    (actualCount) =>
      `スクロール50%イベントが ${actualCount - scrollCountBefore} 件(期待 +1件のまま。再スクロールでの再発火)`
  );
  console.log(
    "  ✓ 同一PV内で最下部→先頭→再最下部としても再発火しない(fireOnce)ことを確認"
  );
}
