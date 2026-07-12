import { gotoDemoPage, leaveTrackedPage } from "../browser/index.js";
import {
  BEACON_SETTLE_MS,
  sleep,
  TIME_ON_PAGE_CANCEL_BOUNCE_INTERVAL_MS,
  TIME_ON_PAGE_TRIGGER_SECONDS,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectNoHitsDuringObservation,
  quiesceBeacons,
} from "../tracking/index.js";

/** 閾値未満で離脱した旧ページの滞在タイマーは、離脱後にイベントを送信しない。 */
export async function testPageLeaveTimerCancel(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/products");

  await sleep(TIME_ON_PAGE_CANCEL_BOUNCE_INTERVAL_MS);
  await leaveTrackedPage(ctx.page);

  await expectNoHitsDuringObservation(
    ctx.tracking,
    {
      afterHitId: hitCursor,
      eventId: ctx.fixtures.timeOnPageEventId,
      type: "event",
    },
    "ページ離脱後の旧 time-on-page timer",
    {
      observationMs: TIME_ON_PAGE_TRIGGER_SECONDS * 1000 + BEACON_SETTLE_MS,
    }
  );
}
