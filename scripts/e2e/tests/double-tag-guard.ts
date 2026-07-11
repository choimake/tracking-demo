import { gotoDemoPage } from "../browser/index.js";
import { TRACKING_ORIGIN, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectPageviewCountExactly,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** タグ二重設置ガード: 2つ目の読み込みは無視される */
export async function testDuplicateTagGuard(ctx: E2eContext): Promise<void> {
  const { tracking, page, trackerLogs, browserName } = ctx;
  const hitCursor = await tracking.captureHitCursor();
  await gotoDemoPage(page, "/");
  await expectPageviewCountExactly(
    tracking,
    hitCursor,
    1,
    "初回 pageview を受信"
  );
  const pageviewCountBefore = await tracking.getPageviewCountAfter(hitCursor);
  const trackerLogsCountBefore = trackerLogs.length;
  await page.addScriptTag({ url: `${TRACKING_ORIGIN}/tracker.js?id=ws-001` });
  await expectPageviewCountExactly(
    tracking,
    hitCursor,
    1,
    "二重設置後もpageviewは1件"
  );
  if (
    !trackerLogs.slice(trackerLogsCountBefore).some((l) => l.includes("二重"))
  ) {
    throw new Error("二重読み込みの警告が出ていない");
  }
  if (
    (await tracking.getPageviewCountAfter(hitCursor)) !== pageviewCountBefore
  ) {
    throw new Error("二重読み込みで pageview が二重計上された");
  }
  console.log("  ✓ 警告を出して2つ目を無視・二重計上なし");

  const hit = await waitForNewHit(
    tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "二重設置ガード pageview ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: null,
    type: "pageview",
    uaIncludes: UA_TOKEN[browserName],
    workspaceId: WORKSPACE_ID,
  });
}
