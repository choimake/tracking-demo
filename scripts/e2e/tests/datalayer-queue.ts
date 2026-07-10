import {
  gotoDemoPage,
  delayTrackerScriptRoute,
  preloadTdDataLayerQueue,
} from "../browser/index.js";
import {
  BEACON_SETTLE_MS,
  TRACKER_SCRIPT_DELAY_MS,
  QUEUE_REPLAY_WAIT_TIMEOUT_MS,
  UA_TOKEN,
  WORKSPACE_ID,
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

/** dataLayer キュー再生: ロード前の push を処理し、かつ二重計上しない */
export async function testDataLayerQueueReplay(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const delayedScriptPage = await ctx.browser.newPage();
  try {
    await delayTrackerScriptRoute(delayedScriptPage, TRACKER_SCRIPT_DELAY_MS);
    await preloadTdDataLayerQueue(delayedScriptPage);
    const sinceMs = Date.now();
    await gotoDemoPage(delayedScriptPage, "/order/complete");
    await waitForCondition(
      "先行 push の再生分の pageview を受信",
      async () => (await ctx.tracking.getPageviewCountSince(sinceMs)) >= 1,
      QUEUE_REPLAY_WAIT_TIMEOUT_MS
    );
    await expectExactPageviewCountAfterDelay(
      ctx.tracking,
      sinceMs,
      1,
      BEACON_SETTLE_MS,
      (actualCount) =>
        `pageview が ${actualCount} 件(期待 1 件。キュー再生と初期PVの二重送信)`
    );
    const purchaseCountAfter =
      await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
    if (purchaseCountAfter !== purchaseCountBefore + 1) {
      throw new Error(
        `URL到達イベントが ${purchaseCountAfter - purchaseCountBefore} 件(期待 1 件。CV二重計上)`
      );
    }
    console.log("  ✓ pageview 1件・URL到達イベント 1件(二重計上なし)");

    const pvHit = await waitForNewHit(
      ctx.tracking,
      { eventId: null, sinceMs, type: "pageview" },
      "キュー再生 pageview ヒット取得",
      QUEUE_REPLAY_WAIT_TIMEOUT_MS
    );
    expectHitPayload(pvHit, {
      eventId: null,
      sinceMs,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      untilMs: Date.now(),
      urlIncludes: "/order/complete",
      workspaceId: WORKSPACE_ID,
    });

    const purchaseHit = await waitForNewHit(
      ctx.tracking,
      { eventId: EVENT_ID_PURCHASE, sinceMs, type: "event" },
      "キュー再生 購入完了ヒット取得",
      QUEUE_REPLAY_WAIT_TIMEOUT_MS
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
  } finally {
    await delayedScriptPage.close();
  }
}
