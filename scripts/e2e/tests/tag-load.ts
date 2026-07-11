import { gotoDemoPage } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectPageviewCountAfter,
  expectTrackerLogContains,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** タグ読み込み + ページビュー送信(dataLayer方式・非同期・クロスオリジン) */
export async function testTagLoadAndPageview(ctx: E2eContext): Promise<void> {
  const hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/");
  await expectPageviewCountAfter(
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
  const tagCheck = await ctx.tracking.getTagCheck(Date.parse(hit.ts));
  if (!tagCheck.hits.some((tagCheckHit) => tagCheckHit.id === hit.id)) {
    throw new Error("/api/tag-check の応答に受信済み pageview が含まれない");
  }
  console.log("  ✓ /api/tag-check が受信済み pageview を返す");
}
