import { gotoDemoPage, clickManualPageview } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID, registeredWait } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import { expectFiredHit, quiesceBeacons } from "../tracking/index.js";

/** dataLayer 連携: tdDataLayer.push({event:"tracker.pageview"}) */
export async function testDataLayerManualPageview(
  ctx: E2eContext
): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  await gotoDemoPage(ctx.page, "/spa");
  await registeredWait("datalayer-manual-dedup-boundary");
  await expectFiredHit({
    act: async () => clickManualPageview(ctx.page),
    exactCount: {
      expectedCount: 1,
      kind: "hit-count",
      label: "手動ページビューを受信",
    },
    expectedPayload: {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/spa",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: null, type: "pageview" },
    hitLabel: "手動 pageview ヒット取得",
    tracking: ctx.tracking,
  });
}
