import {
  getNoReloadMarker,
  gotoDemoPage,
  reloadDemoPage,
  setNoReloadMarker,
} from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import { expectFiredHit, quiesceBeacons } from "../tracking/index.js";

/** reload は新しいドキュメントを読み込み、pageview を正確に1件送信する。 */
export async function testReloadPageview(ctx: E2eContext): Promise<void> {
  await gotoDemoPage(ctx.page, "/products");
  await setNoReloadMarker(ctx.page);
  await quiesceBeacons(ctx.tracking);
  await expectFiredHit({
    act: async () => reloadDemoPage(ctx.page),
    exactCount: {
      expectedCount: 1,
      kind: "hit-count",
      label: "reload 後の pageview",
    },
    expectedPayload: {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/products",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: null, type: "pageview" },
    hitLabel: "reload 後の pageview ヒット取得",
    tracking: ctx.tracking,
  });

  if ((await getNoReloadMarker(ctx.page)) !== undefined) {
    throw new Error("reload 後も旧ドキュメントのマーカーが残っている");
  }
}
