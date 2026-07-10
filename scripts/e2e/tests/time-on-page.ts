import { gotoDemoPage } from "../browser/index.js";
import {
  TIME_ON_PAGE_WAIT_TIMEOUT_MS,
  UA_TOKEN,
  WORKSPACE_ID,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** ページ滞在時間トリガー(2秒) */
export async function testTimeOnPageTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const timeOnPageCountBefore = await ctx.tracking.getEventCount7d(
    ctx.fixtures.timeOnPageEventId
  );
  const sinceMs = Date.now();
  await gotoDemoPage(ctx.page, "/");
  await expectEventCountIncreasedBy(
    ctx.tracking,
    ctx.fixtures.timeOnPageEventId,
    timeOnPageCountBefore,
    1,
    "滞在2秒イベント +1",
    TIME_ON_PAGE_WAIT_TIMEOUT_MS
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { eventId: ctx.fixtures.timeOnPageEventId, sinceMs, type: "event" },
    "滞在2秒ヒット取得",
    TIME_ON_PAGE_WAIT_TIMEOUT_MS
  );
  expectHitPayload(hit, {
    eventId: ctx.fixtures.timeOnPageEventId,
    sinceMs,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: "/",
    workspaceId: WORKSPACE_ID,
  });
}
