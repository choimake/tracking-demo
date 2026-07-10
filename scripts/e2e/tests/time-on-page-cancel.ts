import { gotoDemoPage, spaPushState } from "../browser/index.js";
import {
  BEACON_SETTLE_MS,
  TIME_ON_PAGE_CANCEL_BOUNCE_COUNT,
  TIME_ON_PAGE_CANCEL_BOUNCE_INTERVAL_MS,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  quiesceBeacons,
  expectExactEventCountAfterDelay,
  sleep,
} from "../tracking/index.js";

/**
 * 滞在タイマー破棄: どのページビューも閾値(TIME_ON_PAGE_TRIGGER_SECONDS秒)未満の滞在に
 * 留めて History 遷移を繰り返すと、time_on_page イベントは一度も発火しない
 * (onPageview() が毎回タイマーを張り直す=直前のタイマーは破棄される)
 */
export async function testTimeOnPageCancel(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const { timeOnPageEventId } = ctx.fixtures;
  const countBefore = await ctx.tracking.getEventCount7d(timeOnPageEventId);

  await gotoDemoPage(ctx.page, "/spa");
  for (let i = 0; i < TIME_ON_PAGE_CANCEL_BOUNCE_COUNT; i++) {
    await sleep(TIME_ON_PAGE_CANCEL_BOUNCE_INTERVAL_MS);
    await spaPushState(ctx.page, `/spa/bounce-${i}`);
  }
  const totalBounceMs =
    TIME_ON_PAGE_CANCEL_BOUNCE_INTERVAL_MS * TIME_ON_PAGE_CANCEL_BOUNCE_COUNT;
  console.log(
    `  … 閾値未満(${TIME_ON_PAGE_CANCEL_BOUNCE_INTERVAL_MS}ms間隔)のHistory遷移を${TIME_ON_PAGE_CANCEL_BOUNCE_COUNT}回実施(合計滞在 ${totalBounceMs}ms は元タイマーの閾値を超過)`
  );

  await expectExactEventCountAfterDelay(
    ctx.tracking,
    timeOnPageEventId,
    countBefore,
    BEACON_SETTLE_MS,
    (actualCount) =>
      `滞在2秒イベントが ${actualCount - countBefore} 件増加(期待 0 件。閾値未満の滞在でタイマーが破棄されていない)`
  );
  console.log(
    "  ✓ どのPVも閾値未満の滞在に留めた場合、タイマー破棄によりイベントが発火しないことを確認"
  );
}
