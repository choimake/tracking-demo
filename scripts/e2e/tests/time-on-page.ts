import { gotoDemoPage } from "../browser/index.js";
import {
  TIME_ON_PAGE_WAIT_TIMEOUT_MS,
  UA_TOKEN,
  WORKSPACE_ID,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import { expectFiredHit, quiesceBeacons } from "../tracking/index.js";

/** ページ滞在時間トリガー(2秒) */
export async function testTimeOnPageTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const timeOnPageCountBefore = await ctx.tracking.getEventCount7d(
    ctx.fixtures.timeOnPageEventId
  );
  await expectFiredHit({
    act: async () => gotoDemoPage(ctx.page, "/"),
    exactCount: {
      countBefore: timeOnPageCountBefore,
      eventId: ctx.fixtures.timeOnPageEventId,
      expectedDelta: 1,
      kind: "event-increase",
      label: "滞在2秒イベント +1",
      timeoutMs: TIME_ON_PAGE_WAIT_TIMEOUT_MS,
    },
    expectedPayload: {
      eventId: ctx.fixtures.timeOnPageEventId,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: ctx.fixtures.timeOnPageEventId, type: "event" },
    hitLabel: "滞在2秒ヒット取得",
    hitTimeoutMs: TIME_ON_PAGE_WAIT_TIMEOUT_MS,
    tracking: ctx.tracking,
  });
}
