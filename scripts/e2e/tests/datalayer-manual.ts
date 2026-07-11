import { gotoDemoPage, clickManualPageview } from "../browser/index.js";
import {
  MANUAL_PUSH_GAP_MS,
  UA_TOKEN,
  WORKSPACE_ID,
  sleep,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  quiesceBeacons,
  expectPageviewCountAfter,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** dataLayer 連携: tdDataLayer.push({event:"tracker.pageview"}) */
export async function testDataLayerManualPageview(
  ctx: E2eContext
): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  await gotoDemoPage(ctx.page, "/spa");
  await sleep(MANUAL_PUSH_GAP_MS);
  const hitCursor = await ctx.tracking.captureHitCursor();
  await clickManualPageview(ctx.page);
  await expectPageviewCountAfter(
    ctx.tracking,
    hitCursor,
    1,
    "手動ページビューを受信"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "手動 pageview ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/spa",
    workspaceId: WORKSPACE_ID,
  });
}
