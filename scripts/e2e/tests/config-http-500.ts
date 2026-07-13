import {
  gotoDemoPageWithoutTrackerWait,
  inspectFailureQueue,
  installConfigHttp500,
  observePageErrors,
  preloadFailureQueueSentinel,
} from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectNoHitsDuringObservation,
  expectTrackerLogContains,
} from "../tracking/index.js";

/** Config 500で初期化を停止し、queueを保持してretryしない。 */
export async function testConfigHttp500(ctx: E2eContext): Promise<void> {
  const { page, trackerLogs, tracking } = ctx;
  await preloadFailureQueueSentinel(page);
  const configProbe = await installConfigHttp500(ctx, page);
  const pageErrorProbe = observePageErrors(page);
  const hitCursor = await tracking.captureHitCursor();
  const trackerLogStart = trackerLogs.length;
  try {
    await gotoDemoPageWithoutTrackerWait(page, "/");
    await expectTrackerLogContains(
      trackerLogs,
      "設定の取得に失敗しました",
      "Config 500の失敗ログ",
      trackerLogStart
    );
    // console.warn の Error オブジェクト引数はブラウザごとに文字列化が異なる。
    // Firefoxでは "config HTTP 500" が ConsoleMessage.text() に含まれないため、
    // tracker自身の共通契約である設定取得失敗メッセージだけを検証する。
    await expectNoHitsDuringObservation(
      tracking,
      { afterHitId: hitCursor },
      "Config 500後の全Hit"
    );

    const queue = await inspectFailureQueue(page);
    if (!queue.sentinelPresent || !queue.pushAddedItem) {
      throw new Error("Config 500後にtdDataLayer queueが破壊された");
    }
    if (trackerLogs.slice(trackerLogStart).length !== 1) {
      throw new Error("Config 500のtracker由来consoleログが1件でない");
    }
    if (configProbe.requests.length !== 1) {
      throw new Error(
        `Config要求が${configProbe.requests.length}回 (期待1回。retry禁止)`
      );
    }
    if (pageErrorProbe.errors.length !== 0) {
      throw new Error(`page errorを${pageErrorProbe.errors.length}件検出`);
    }
  } finally {
    pageErrorProbe.dispose();
    await configProbe.dispose();
  }
}
