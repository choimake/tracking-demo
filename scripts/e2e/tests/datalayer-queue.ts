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
  expectEventCountExactly,
  quiesceBeacons,
  waitForCondition,
  expectPageviewCountExactly,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** dataLayer キュー再生: ロード前の push を処理し、かつ二重計上しない */
export async function testDataLayerQueueReplay(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const delayedScriptPage = await ctx.newPage();
  await delayTrackerScriptRoute(
    ctx,
    delayedScriptPage,
    TRACKER_SCRIPT_DELAY_MS
  );
  await preloadTdDataLayerQueue(delayedScriptPage);
  const hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(delayedScriptPage, "/order/complete");
  await waitForCondition(
    "先行 push の再生分の pageview を受信",
    async () => (await ctx.tracking.getPageviewCountAfter(hitCursor)) >= 1,
    QUEUE_REPLAY_WAIT_TIMEOUT_MS
  );
  await expectPageviewCountExactly(
    ctx.tracking,
    hitCursor,
    1,
    "キュー再生と初期PVの二重送信なし",
    { observationMs: BEACON_SETTLE_MS }
  );
  await expectEventCountExactly(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    purchaseCountBefore + 1,
    "キュー再生のURL到達イベント"
  );
  console.log("  ✓ pageview 1件・URL到達イベント 1件(二重計上なし)");

  const pvHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "キュー再生 pageview ヒット取得",
    QUEUE_REPLAY_WAIT_TIMEOUT_MS
  );
  expectHitPayload(pvHit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });

  const purchaseHit = await waitForNewHit(
    ctx.tracking,
    {
      afterHitId: hitCursor,
      eventId: EVENT_ID_PURCHASE,
      type: "event",
    },
    "キュー再生 購入完了ヒット取得",
    QUEUE_REPLAY_WAIT_TIMEOUT_MS
  );
  expectHitPayload(purchaseHit, {
    eventId: EVENT_ID_PURCHASE,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/order/complete",
    workspaceId: WORKSPACE_ID,
  });
}
