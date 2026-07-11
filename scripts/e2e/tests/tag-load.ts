import { gotoDemoPage } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectPageviewCountExactly,
  expectTagCheckContainsHit,
  expectTrackerLogContains,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** タグ読み込み + ページビュー送信(dataLayer方式・非同期・クロスオリジン) */
export async function testTagLoadAndPageview(ctx: E2eContext): Promise<void> {
  const hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/");
  await expectPageviewCountExactly(
    ctx.tracking,
    hitCursor,
    1,
    "pageview ビーコンを受信"
  );
  await expectTrackerLogContains(
    ctx.trackerLogs,
    "初期化完了",
    "tracker 初期化ログ"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "pageview ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/",
    workspaceId: WORKSPACE_ID,
  });
  await expectTagCheckContainsHit(ctx.tracking, hit);
}
