import {
  getNoReloadMarker,
  goBackTwice,
  goForwardTwice,
  gotoDemoPage,
  setNoReloadMarker,
  spaPushState,
} from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectFiredHit,
  expectHitPayload,
  quiesceBeacons,
} from "../tracking/index.js";

/** back/forward の4操作は、各移動先の pageview を正確に1件ずつ送信する。 */
export async function testHistoryTraversal(ctx: E2eContext): Promise<void> {
  await gotoDemoPage(ctx.page, "/spa");
  await setNoReloadMarker(ctx.page);
  await spaPushState(ctx.page, "/lifecycle/first");
  await spaPushState(ctx.page, "/lifecycle/second");
  await quiesceBeacons(ctx.tracking);

  await expectTraversalHits(
    ctx,
    async () => goBackTwice(ctx.page),
    ["/lifecycle/first", "/spa"],
    "back 2回の pageview"
  );

  await expectTraversalHits(
    ctx,
    async () => goForwardTwice(ctx.page),
    ["/lifecycle/first", "/lifecycle/second"],
    "forward 2回の pageview"
  );

  if ((await getNoReloadMarker(ctx.page)) !== 1) {
    throw new Error("back/forward の履歴移動でページがリロードされた");
  }
}

async function expectTraversalHits(
  ctx: E2eContext,
  act: () => Promise<void>,
  expectedPaths: string[],
  label: string
): Promise<void> {
  const { hitCursor } = await expectFiredHit({
    act,
    exactCount: { expectedCount: 2, kind: "hit-count", label },
    expectedPayload: {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: null, type: "pageview" },
    hitLabel: `${label}の最新Hit`,
    tracking: ctx.tracking,
  });
  const pageviewHits = await ctx.tracking.getPageviewHitsAfter(hitCursor);
  for (const hit of pageviewHits) {
    expectHitPayload(hit, {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      workspaceId: WORKSPACE_ID,
    });
  }
  for (const expectedPath of expectedPaths) {
    const actualCount = pageviewHits.filter((hit) =>
      hit.url.includes(expectedPath)
    ).length;
    if (actualCount !== 1) {
      throw new Error(
        `${label}: ${expectedPath} の pageview が ${actualCount} 件(期待 1 件)`
      );
    }
  }
}
