import { runExitIntentMobileAct } from "../browser/index.js";
import {
  EXIT_INTENT_MOBILE_CHECK_DELAY_MS,
  parseRecordVideoMode,
} from "../harness/config.js";
import { createE2eSession } from "../harness/session.js";
import type { E2eContext } from "../harness/types.js";
import { finalizeScenarioVideo } from "../harness/video.js";
import {
  EVENT_ID_EXIT_INTENT,
  quiesceBeacons,
  expectNoHitsDuringObservation,
} from "../tracking/index.js";

/**
 * モバイルで exit_intent 非発火: モバイルコンテキスト(isMobile/hasTouch)で
 * タップ相当の操作のみを行い、合成 mouseout は使わない。
 * 離脱インテントはデスクトップのカーソル操作(mouseout)前提のトリガーのため、
 * タップ操作だけでは発火しないことを確認する
 */
export async function testExitIntentMobile(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const hitCursor = await ctx.tracking.captureHitCursor();

  // E2E_MOBILE 時は外側が既にモバイル＋録画対象なので内側 context を作らず ctx.page で Act
  if (ctx.mobile) {
    await runExitIntentMobileAct(ctx.page);
    await assertNoExitIntent(ctx, hitCursor);
    return;
  }

  // デスクトップ外側: 従来どおり内側にモバイル session を作る
  // (createE2eSession 内で browserName に応じて isMobile を分岐)
  const { page, context } = await createE2eSession(ctx.browser, {
    browserName: ctx.browserName,
    correlationId: ctx.correlationId,
    mobile: true,
    recordVideoDir: ctx.recordVideoDir,
    userAgent: ctx.userAgent,
  });
  let ok = false;
  try {
    await runExitIntentMobileAct(page);
    await assertNoExitIntent(ctx, hitCursor);
    ok = true;
  } finally {
    try {
      await context.close();
    } catch (error) {
      console.error(`  context.close failed: ${String(error)}`);
    }
    // 内側 Act の動画を scenarioVideoPath へ確定(外側の空動画で上書きされないよう先に書く)
    if (ctx.scenarioVideoPath && ctx.recordVideoDir) {
      const mode = parseRecordVideoMode();
      if (mode) {
        await finalizeScenarioVideo({
          mode,
          ok,
          page,
          videoPath: ctx.scenarioVideoPath,
        });
      }
    }
  }
}

async function assertNoExitIntent(
  ctx: E2eContext,
  hitCursor: string | undefined
): Promise<void> {
  await expectNoHitsDuringObservation(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: EVENT_ID_EXIT_INTENT, type: "event" },
    "モバイルのタップ操作による離脱インテントイベント",
    { observationMs: EXIT_INTENT_MOBILE_CHECK_DELAY_MS }
  );
  console.log(
    "  ✓ モバイル(isMobile/hasTouch)ではタップ操作のみで離脱インテントが発火しないことを確認"
  );
}
