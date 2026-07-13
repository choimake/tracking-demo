import {
  disposeRequestProbes,
  forceSendBeaconFalse,
  gotoDemoPageWithoutTrackerWait,
  installEmptyConfig,
  observeCollectRequests,
  observePageErrors,
} from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectHitPayload,
  expectPageviewCountExactly,
  waitForNewHit,
} from "../tracking/index.js";

/** sendBeacon=false時にfetch fallbackを1回だけ実行する。 */
export async function testCollectSendBeaconFallback(
  ctx: E2eContext
): Promise<void> {
  const { browserName, page, trackerLogs, tracking } = ctx;
  await forceSendBeaconFalse(page);
  const configProbe = await installEmptyConfig(ctx, page);
  const collectProbe = await observeCollectRequests(ctx, page);
  const pageErrorProbe = observePageErrors(page);
  const hitCursor = await tracking.captureHitCursor();
  const trackerLogStart = trackerLogs.length;
  try {
    await gotoDemoPageWithoutTrackerWait(page, "/");
    await expectPageviewCountExactly(
      tracking,
      hitCursor,
      1,
      "sendBeacon=false時のfallback pageview"
    );
    const hit = await waitForNewHit(
      tracking,
      { afterHitId: hitCursor, eventId: null, type: "pageview" },
      "fallback pageview Hit"
    );
    expectHitPayload(hit, {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[browserName],
      urlIncludes: "/",
      workspaceId: WORKSPACE_ID,
    });

    const scenarioLogs = trackerLogs.slice(trackerLogStart);
    if (
      scenarioLogs.length !== 2 ||
      !scenarioLogs.some((log) => log.includes("初期化完了")) ||
      !scenarioLogs.some((log) => log.includes("ページビュー:"))
    ) {
      throw new Error(
        `fallback時のtracker由来consoleログが不一致: ${JSON.stringify(scenarioLogs)}`
      );
    }

    if (collectProbe.requests.length !== 1) {
      throw new Error(
        `fallback fetchが${collectProbe.requests.length}回 (期待1回)`
      );
    }
    const request = collectProbe.requests[0];
    if (request.method() !== "POST" || request.resourceType() !== "fetch") {
      throw new Error(
        `fallback要求が不正: method=${request.method()} resourceType=${request.resourceType()}`
      );
    }
    if (pageErrorProbe.errors.length !== 0) {
      throw new Error(`page errorを${pageErrorProbe.errors.length}件検出`);
    }
  } finally {
    pageErrorProbe.dispose();
    await disposeRequestProbes(collectProbe, configProbe);
  }
}
