import {
  DEMO_SITE_ORIGIN,
  EXIT_INTENT_MOBILE_CHECK_DELAY_MS,
  MOBILE_VIEWPORT,
} from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
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

  // isMobile はFirefoxでは未サポート(コンテキスト生成が例外になる)ため、
  // Chromium/WebKit のみ isMobile を付与する。hasTouch/viewport は全エンジン共通
  const context = await ctx.browser.newContext({
    hasTouch: true,
    isMobile: ctx.browserName === "firefox" ? undefined : true,
    viewport: MOBILE_VIEWPORT,
  });
  try {
    const page = await context.newPage();
    try {
      await page.goto(`${DEMO_SITE_ORIGIN}/`, { waitUntil: "load" });
      // タップ相当の操作のみ(合成 mouseout は使わない)。
      // body 全体をタップすると本文中のリンクに当たり遷移してしまうため、
      // リンクを含まない見出し(h1)を対象にする
      await page.locator("h1").tap();
      await page.evaluate(() => window.scrollTo(0, 200));
      await page.locator("h1").tap();

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
    } finally {
      await page.close();
    }
  } finally {
    await context.close();
  }
}
