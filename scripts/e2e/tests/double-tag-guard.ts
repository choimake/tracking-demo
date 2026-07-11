import { gotoDemoPage } from "../browser/index.js";
import {
  TRACKING_ORIGIN,
  BEACON_SETTLE_MS,
  UA_TOKEN,
  WORKSPACE_ID,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectPageviewCountSince,
  sleep,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/** タグ二重設置ガード: 2つ目の読み込みは無視される */
export async function testDuplicateTagGuard(ctx: E2eContext): Promise<void> {
  const { tracking, page, trackerLogs, browserName } = ctx;
  const sinceMs = Date.now();
  await gotoDemoPage(page, "/");
  await expectPageviewCountSince(tracking, sinceMs, 1, "初回 pageview を受信");
  const pageviewCountBefore = await tracking.getPageviewCountSince(sinceMs);
  const trackerLogsCountBefore = trackerLogs.length;
  await page.addScriptTag({ url: `${TRACKING_ORIGIN}/tracker.js?id=ws-001` });
  await sleep(BEACON_SETTLE_MS);
  if (
    !trackerLogs.slice(trackerLogsCountBefore).some((l) => l.includes("二重"))
  ) {
    throw new Error("二重読み込みの警告が出ていない");
  }
  if ((await tracking.getPageviewCountSince(sinceMs)) !== pageviewCountBefore) {
    throw new Error("二重読み込みで pageview が二重計上された");
  }
  console.log("  ✓ 警告を出して2つ目を無視・二重計上なし");

  const hit = await waitForNewHit(
    tracking,
    { eventId: null, sinceMs, type: "pageview" },
    "二重設置ガード pageview ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: null,
    sinceMs,
    type: "pageview",
    uaIncludes: UA_TOKEN[browserName],
    untilMs: Date.now(),
    workspaceId: WORKSPACE_ID,
  });
}
