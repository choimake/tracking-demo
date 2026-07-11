import { gotoDemoPage } from "../browser/index.js";
import {
  TRACKING_ORIGIN,
  DEMO_SITE_ORIGIN,
  DISABLED_EVENT_RECEIVE_CHECK_DELAY_MS,
  DISABLED_EVENT_BROWSER_CHECK_DELAY_MS,
  sleep,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import { expectNoHitsDuringObservation } from "../tracking/index.js";

/** 無効イベントは計測停止(配信除外・受信破棄・0件表示) */
export async function testDisabledEventStopsTracking(
  ctx: E2eContext
): Promise<void> {
  const { tracking, page, trackerLogs, fixtures } = ctx;
  const { timeOnPageEventId } = fixtures;
  // ブラウザマトリクスで後続エンジンの time-on-page が動くよう、必ず有効に戻す
  await tracking.toggleEvent(timeOnPageEventId, false);
  try {
    const disabledEventCheckUrl = `${DEMO_SITE_ORIGIN}/__disabled_check_${Date.now()}`;
    const res = await fetch(`${TRACKING_ORIGIN}/api/collect`, {
      body: JSON.stringify({
        ws: "ws-001",
        eventId: timeOnPageEventId,
        type: "event",
        url: disabledEventCheckUrl,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await res.json()) as { ok: boolean };
    if (res.status !== 202 || body.ok !== false) {
      throw new Error(`受信側が破棄しなかった (HTTP ${res.status})`);
    }
    await sleep(DISABLED_EVENT_RECEIVE_CHECK_DELAY_MS);
    if (
      (await tracking.getHitsForEvent(timeOnPageEventId)).some(
        (h) => h.url === disabledEventCheckUrl
      )
    ) {
      throw new Error("無効イベントのヒットが記録された");
    }
    console.log("  ✓ 受信側で破棄(HTTP 202・記録なし)");

    // 直前テストの滞在タイマーが残っていると誤検知するため、遷移後のログだけ見る
    const hitCursor = await tracking.captureHitCursor();
    await gotoDemoPage(page, "/");
    const trackerLogsCountBefore = trackerLogs.length;
    await expectNoHitsDuringObservation(
      tracking,
      { afterHitId: hitCursor, eventId: timeOnPageEventId, type: "event" },
      "無効イベントのブラウザ発火",
      { observationMs: DISABLED_EVENT_BROWSER_CHECK_DELAY_MS }
    );
    if (
      trackerLogs
        .slice(trackerLogsCountBefore)
        .some((l) => l.includes("E2E滞在2秒"))
    ) {
      throw new Error("無効化したイベントがブラウザ側で発火した");
    }
    if ((await tracking.getEventCount7dFromApi(timeOnPageEventId)) !== 0) {
      throw new Error("無効イベントの件数が0件表示でない");
    }
    console.log("  ✓ 配信除外で発火せず・0件表示");
  } finally {
    await tracking.toggleEvent(timeOnPageEventId, true).catch(() => {});
  }
}
