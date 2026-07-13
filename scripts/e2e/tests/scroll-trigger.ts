import { gotoDemoPage, scrollToExactPercent } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_SCROLL_50,
  expectFiredHit,
  quiesceBeacons,
} from "../tracking/index.js";

/** スクロール率トリガー(ちょうど50%境界) */
export async function testScrollTrigger(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const scrollCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_SCROLL_50);
  await expectFiredHit({
    act: async () => {
      await gotoDemoPage(ctx.page, "/products");
      // 境界殺傷: `>= 50` は発火、`> 50` 変異は未発火
      // trackerと同じ式で計算したスクロール率が50であることを確認する。
      const measured = await scrollToExactPercent(ctx.page, 50);
      if (measured !== 50) {
        throw new Error(
          `スクロール率がちょうど50%ではない: measured=${measured}`
        );
      }
      console.log("  ✓ スクロール率ちょうど50%(tracker同式)を確認");
    },
    exactCount: {
      countBefore: scrollCountBefore,
      eventId: EVENT_ID_SCROLL_50,
      expectedDelta: 1,
      kind: "event-increase",
      label: "スクロール50%イベント発火",
    },
    expectedPayload: {
      eventId: EVENT_ID_SCROLL_50,
      type: "event",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/products",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: EVENT_ID_SCROLL_50, type: "event" },
    hitLabel: "スクロール50%ヒット取得",
    tracking: ctx.tracking,
  });
}
