import { gotoDemoPage } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectFiredHit,
  expectTagCheckContainsHit,
  expectTrackerLogContains,
} from "../tracking/index.js";

/** タグ読み込み + ページビュー送信(dataLayer方式・非同期・クロスオリジン) */
export async function testTagLoadAndPageview(ctx: E2eContext): Promise<void> {
  const { hit } = await expectFiredHit({
    act: async () => gotoDemoPage(ctx.page, "/"),
    exactCount: {
      expectedCount: 1,
      kind: "hit-count",
      label: "pageview ビーコンを受信",
    },
    expectedPayload: {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: "/",
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: null, type: "pageview" },
    hitLabel: "pageview ヒット取得",
    tracking: ctx.tracking,
  });
  await expectTrackerLogContains(
    ctx.trackerLogs,
    "初期化完了",
    "tracker 初期化ログ"
  );
  await expectTagCheckContainsHit(ctx.tracking, hit);
}
