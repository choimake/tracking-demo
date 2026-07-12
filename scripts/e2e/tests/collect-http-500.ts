import {
  disposeRequestProbes,
  forceSendBeaconFalse,
  gotoDemoPageWithoutTrackerWait,
  installCollectHttp500,
  installEmptyConfig,
  observePageErrors,
} from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import { expectNoHitsDuringObservation } from "../tracking/index.js";

/** fallback fetchのHTTP 500を握りつぶし、retryとunhandled rejectionを出さない。 */
export async function testCollectHttp500(ctx: E2eContext): Promise<void> {
  const { page, trackerLogs, tracking } = ctx;
  await forceSendBeaconFalse(page);
  const configProbe = await installEmptyConfig(page);
  const collectProbe = await installCollectHttp500(page);
  const pageErrorProbe = observePageErrors(page);
  const hitCursor = await tracking.captureHitCursor();
  const trackerLogStart = trackerLogs.length;
  try {
    await gotoDemoPageWithoutTrackerWait(page, "/");
    await expectNoHitsDuringObservation(
      tracking,
      { afterHitId: hitCursor },
      "Collect 500後の全Hit"
    );
    const scenarioLogs = trackerLogs.slice(trackerLogStart);
    if (
      scenarioLogs.length !== 2 ||
      !scenarioLogs.some((log) => log.includes("初期化完了")) ||
      !scenarioLogs.some((log) => log.includes("ページビュー:"))
    ) {
      throw new Error(
        `Collect 500時のtracker由来consoleログが不一致: ${JSON.stringify(scenarioLogs)}`
      );
    }
    if (collectProbe.requests.length !== 1) {
      throw new Error(
        `Collect要求が${collectProbe.requests.length}回 (期待1回。retry禁止)`
      );
    }
    if (pageErrorProbe.errors.length !== 0) {
      throw new Error(
        `unhandled rejection/page errorを${pageErrorProbe.errors.length}件検出`
      );
    }
  } finally {
    pageErrorProbe.dispose();
    await disposeRequestProbes(collectProbe, configProbe);
  }
}
