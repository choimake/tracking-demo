import { runExitIntentMobileAct } from "../browser/index.js";
import { EXIT_INTENT_MOBILE_CHECK_DELAY_MS } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
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

  // デスクトップ外側では、内側にmanaged mobile sessionを作る。
  await ctx.withSession(
    { mobile: true, recordScenarioVideo: true },
    async ({ page }) => {
      await runExitIntentMobileAct(page);
      await assertNoExitIntent(ctx, hitCursor);
    }
  );
}

async function assertNoExitIntent(
  ctx: E2eContext,
  hitCursor: string | undefined
): Promise<void> {
  await expectNoHitsDuringObservation(
    ctx.tracking,
    {
      afterHitId: hitCursor,
      eventId: ctx.fixtures.exitIntentEventId,
      type: "event",
    },
    "モバイルのタップ操作による離脱インテントイベント",
    { observationMs: EXIT_INTENT_MOBILE_CHECK_DELAY_MS }
  );
  console.log(
    "  ✓ モバイル(isMobile/hasTouch)ではタップ操作のみで離脱インテントが発火しないことを確認"
  );
}
