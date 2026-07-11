import { gotoDemoPage, scrollToExactPercent } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_SCROLL_50,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** スクロール率トリガー(ちょうど50%境界) */
export async function testScrollTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const scrollCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_SCROLL_50);
  const sinceMs = Date.now();
  await gotoDemoPage(ctx.page, "/products");
  // 境界殺傷: `>= 50` は発火、`> 50` 変異は未発火
  // scrollToExactPercent は tracker 同式の実測値がちょうど 50 であることを返す
  const measured = await scrollToExactPercent(ctx.page, 50);
  if (measured !== 50) {
    throw new Error(`スクロール率がちょうど50%ではない: measured=${measured}`);
  }
  console.log("  ✓ スクロール率ちょうど50%(tracker同式)を確認");
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_SCROLL_50,
    scrollCountBefore,
    1,
    "スクロール50%イベント発火"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { eventId: EVENT_ID_SCROLL_50, sinceMs, type: "event" },
    "スクロール50%ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: EVENT_ID_SCROLL_50,
    sinceMs,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: "/products",
    workspaceId: WORKSPACE_ID,
  });
}
