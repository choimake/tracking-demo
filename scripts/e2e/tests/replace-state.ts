import {
  getNoReloadMarker,
  gotoDemoPage,
  setNoReloadMarker,
  spaReplaceState,
} from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectHitPayload,
  expectPageviewCountExactly,
  quiesceBeacons,
  waitForNewHit,
} from "../tracking/index.js";

/** replaceState のパス変更は、リロードなしで pageview を正確に1件送信する。 */
export async function testReplaceStatePathChange(
  ctx: E2eContext
): Promise<void> {
  await gotoDemoPage(ctx.page, "/spa");
  await setNoReloadMarker(ctx.page);
  await quiesceBeacons(ctx.tracking);
  const hitCursor = await ctx.tracking.captureHitCursor();

  await spaReplaceState(ctx.page, "/lifecycle/replaced");

  await expectPageviewCountExactly(
    ctx.tracking,
    hitCursor,
    1,
    "パス変更 replaceState の pageview"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "パス変更 replaceState の pageview ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/lifecycle/replaced",
    workspaceId: WORKSPACE_ID,
  });

  if ((await getNoReloadMarker(ctx.page)) !== 1) {
    throw new Error("replaceState のパス変更でページがリロードされた");
  }
}
