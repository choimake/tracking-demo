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
  expectExactEventCountAfterDelay,
} from "../tracking/index.js";

/**
 * モバイルで exit_intent 非発火: モバイルコンテキスト(isMobile/hasTouch)で
 * タップ相当の操作のみを行い、合成 mouseout は使わない。
 * 離脱インテントはデスクトップのカーソル操作(mouseout)前提のトリガーのため、
 * タップ操作だけでは発火しないことを確認する
 */
export async function testExitIntentMobile(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const exitCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_EXIT_INTENT);

  // E2E_MOBILE 時は外側が既にモバイル＋録画対象なので内側 context を作らず ctx.page で Act
  if (ctx.mobile) {
    await runExitIntentMobileAct(ctx.page);
    await assertNoExitIntent(ctx, exitCountBefore);
    return;
  }

  // デスクトップ外側: 従来どおり内側にモバイル session を作る
  // (createE2eSession 内で browserName に応じて isMobile を分岐)
  const { page, context } = await createE2eSession(ctx.browser, {
    browserName: ctx.browserName,
    mobile: true,
    recordVideoDir: ctx.recordVideoDir,
  });
  let ok = false;
  try {
    await runExitIntentMobileAct(page);
    await assertNoExitIntent(ctx, exitCountBefore);
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
  exitCountBefore: number
): Promise<void> {
  await expectExactEventCountAfterDelay(
    ctx.tracking,
    EVENT_ID_EXIT_INTENT,
    exitCountBefore,
    EXIT_INTENT_MOBILE_CHECK_DELAY_MS,
    (actualCount) =>
      `モバイルコンテキストで離脱インテントイベントが ${actualCount - exitCountBefore} 件増加(期待 0 件。タップ操作のみでは発火しないはず)`
  );
  console.log(
    "  ✓ モバイル(isMobile/hasTouch)ではタップ操作のみで離脱インテントが発火しないことを確認"
  );
}
