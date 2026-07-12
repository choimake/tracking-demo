import {
  getNoReloadMarker,
  gotoDemoPage,
  reloadDemoPage,
  setNoReloadMarker,
} from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectHitPayload,
  expectPageviewCountExactly,
  quiesceBeacons,
  waitForNewHit,
} from "../tracking/index.js";

/** reload は新しいドキュメントを読み込み、pageview を正確に1件送信する。 */
export async function testReloadPageview(ctx: E2eContext): Promise<void> {
  await gotoDemoPage(ctx.page, "/products");
  await setNoReloadMarker(ctx.page);
  await quiesceBeacons(ctx.tracking);
  const hitCursor = await ctx.tracking.captureHitCursor();

  await reloadDemoPage(ctx.page);

  await expectPageviewCountExactly(
    ctx.tracking,
    hitCursor,
    1,
    "reload 後の pageview"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "reload 後の pageview ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/products",
    workspaceId: WORKSPACE_ID,
  });

  if ((await getNoReloadMarker(ctx.page)) !== undefined) {
    throw new Error("reload 後も旧ドキュメントのマーカーが残っている");
  }
}
