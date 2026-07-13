import {
  disposeRequestProbes,
  gotoDemoPageWithoutTrackerWait,
  installTrackerScriptHttp404,
  observeCollectRequests,
  observeConfigRequests,
  observePageErrors,
} from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import { expectNoHitsDuringObservation } from "../tracking/index.js";

/** tracker.js 404では初期化せず、API要求とHitを発生させない。 */
export async function testTrackerScriptHttp404(ctx: E2eContext): Promise<void> {
  const { page, trackerLogs, tracking } = ctx;
  const trackerProbe = await installTrackerScriptHttp404(ctx, page);
  const configProbe = await observeConfigRequests(ctx, page);
  const collectProbe = await observeCollectRequests(ctx, page);
  const pageErrorProbe = observePageErrors(page);
  const hitCursor = await tracking.captureHitCursor();
  const trackerLogStart = trackerLogs.length;
  try {
    await gotoDemoPageWithoutTrackerWait(page, "/");
    await expectNoHitsDuringObservation(
      tracking,
      { afterHitId: hitCursor },
      "tracker.js 404後の全Hit"
    );
    if (trackerProbe.requests.length !== 1) {
      throw new Error(
        `tracker.js要求が${trackerProbe.requests.length}回 (期待1回)`
      );
    }
    if (
      configProbe.requests.length !== 0 ||
      collectProbe.requests.length !== 0
    ) {
      throw new Error(
        `tracker.js 404後にAPI要求を検出: config=${configProbe.requests.length} collect=${collectProbe.requests.length}`
      );
    }
    if (trackerLogs.length !== trackerLogStart) {
      throw new Error("tracker.js 404後にtracker由来consoleログを検出");
    }
    if (pageErrorProbe.errors.length !== 0) {
      throw new Error(`page errorを${pageErrorProbe.errors.length}件検出`);
    }
  } finally {
    pageErrorProbe.dispose();
    await disposeRequestProbes(collectProbe, configProbe, trackerProbe);
  }
}
