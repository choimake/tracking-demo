import { gotoDemoPage, scrollToBottom } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_SCROLL_50,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** スクロール率トリガー(50%) */
export async function testScrollTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const scrollCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_SCROLL_50);
  const sinceMs = Date.now();
  await gotoDemoPage(ctx.page, "/products");
  await scrollToBottom(ctx.page);
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
