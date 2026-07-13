import {
  gotoDemoPage,
  clickAddToCart,
  scrollToBottom,
  scrollToTop,
} from "../browser/index.js";
import { BEACON_SETTLE_MS, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_CART,
  EVENT_ID_SCROLL_50,
  expectEventCountExactly,
  expectFiredHit,
  quiesceBeacons,
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
  // --- クリック: 2回押して +2(fire、1PV内で複数回発火を許容) ---
  await expectFiredHit({
    act: async () => {
      await gotoDemoPage(ctx.page, "/products");
      await clickAddToCart(ctx.page);
      await clickAddToCart(ctx.page);
    },
    exactCount: {
      countBefore: cartCountBefore,
      eventId: EVENT_ID_CART,
      expectedDelta: 2,
      kind: "event-increase",
      label:
        "カート追加ボタンを2回クリックしてイベントが+2件(クリックは複数回発火)",
    },
    expectedPayload: {
      eventId: EVENT_ID_CART,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/products",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: EVENT_ID_CART, type: "event" },
    hitLabel: "カート追加ヒット取得",
    tracking: ctx.tracking,
  });
  console.log("  ✓ クリックは押した回数だけ発火(fire)することを確認");

  // --- スクロール: 最下部→先頭→再最下部でも +1 のまま(fireOnce、同一PV内では再発火なし) ---
  await expectFiredHit({
    act: async () => scrollToBottom(ctx.page),
    exactCount: {
      countBefore: scrollCountBefore,
      eventId: EVENT_ID_SCROLL_50,
      expectedDelta: 1,
      kind: "event-increase",
      label: "最下部スクロールでスクロール50%イベント+1",
    },
    expectedPayload: {
      eventId: EVENT_ID_SCROLL_50,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/products",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: EVENT_ID_SCROLL_50, type: "event" },
    hitLabel: "スクロール50%ヒット取得",
    tracking: ctx.tracking,
  });

  await scrollToTop(ctx.page);
  await scrollToBottom(ctx.page);
  await expectEventCountExactly(
    ctx.tracking,
    EVENT_ID_SCROLL_50,
    scrollCountBefore + 1,
    "再スクロール後もスクロール50%イベントは+1件のまま",
    { observationMs: BEACON_SETTLE_MS }
  );
  console.log(
    "  ✓ 同一PV内で最下部→先頭→再最下部としても再発火しない(fireOnce)ことを確認"
  );
}
