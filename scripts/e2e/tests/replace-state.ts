import {
  getNoReloadMarker,
  gotoDemoPage,
  setNoReloadMarker,
  spaReplaceState,
} from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import { expectFiredHit, quiesceBeacons } from "../tracking/index.js";

/** replaceState のパス変更は、リロードなしで pageview を正確に1件送信する。 */
export async function testReplaceStatePathChange(
  ctx: E2eContext
): Promise<void> {
  await gotoDemoPage(ctx.page, "/spa");
  await setNoReloadMarker(ctx.page);
  await quiesceBeacons(ctx.tracking);
  await expectFiredHit({
    act: async () => spaReplaceState(ctx.page, "/lifecycle/replaced"),
    exactCount: {
      expectedCount: 1,
      kind: "hit-count",
      label: "パス変更 replaceState の pageview",
    },
    expectedPayload: {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/lifecycle/replaced",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: null, type: "pageview" },
    hitLabel: "パス変更 replaceState の pageview ヒット取得",
    tracking: ctx.tracking,
  });

  if ((await getNoReloadMarker(ctx.page)) !== 1) {
    throw new Error("replaceState のパス変更でページがリロードされた");
  }
}
