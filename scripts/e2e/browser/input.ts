import type { E2ePage, ManagedSession } from "../harness/types.js";
import {
  gotoDemoPageWithoutTrackerWait,
  gotoDemoPageWithTrackerScriptGate,
} from "./navigation.js";

/** このモジュールは、クリック、スクロール、ポインター、dataLayer の入力を発生させる。 */

/** products.html の「カートに入れる」ボタンをクリックする。 */
export async function clickAddToCart(page: E2ePage): Promise<void> {
  await page.getByRole("button", { name: "カートに入れる" }).first().click();
}

/** `.add-to-cart` ボタン内の子要素をクリックする。 */
export async function clickAddToCartChild(page: E2ePage): Promise<void> {
  await page
    .getByRole("button", { name: "カートに入れる" })
    .first()
    .locator("span")
    .click();
}

/** ページ最下部までスクロールし、スクロール率トリガーを発火させる。 */
export async function scrollToBottom(page: E2ePage): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight)
  );
}

/** スクロール率をちょうど percent% にする。 */
export async function scrollToExactPercent(
  page: E2ePage,
  percent: number
): Promise<number> {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error(
      `scrollToExactPercent: percent は 0〜100 の整数である必要: ${percent}`
    );
  }
  const measured = await page.evaluate(`((targetPercent) => {
    const SPACER_ATTR = "data-e2e-scroll-spacer";

    const getTotal = () =>
      document.documentElement.scrollHeight - window.innerHeight;

    const measure = (scrollY, total) =>
      total > 0 ? (scrollY / total) * 100 : NaN;

    const ensureSpacer = () => {
      let spacer = document.querySelector("[" + SPACER_ATTR + "]");
      if (!spacer) {
        spacer = document.createElement("div");
        spacer.setAttribute(SPACER_ATTR, "1");
        spacer.style.height = "0px";
        document.body.appendChild(spacer);
      }
      return spacer;
    };

    const growSpacer = (px) => {
      const spacer = ensureSpacer();
      const current = Number.parseFloat(spacer.style.height) || 0;
      spacer.style.height = current + px + "px";
    };

    while (getTotal() <= 0) {
      growSpacer(window.innerHeight + 200);
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const total = getTotal();
      if ((total * targetPercent) % 100 !== 0) {
        growSpacer(1);
        continue;
      }
      const targetY = (total * targetPercent) / 100;
      if (!Number.isInteger(targetY)) {
        growSpacer(1);
        continue;
      }

      window.scrollTo(0, targetY);
      const totalAfter =
        document.documentElement.scrollHeight - window.innerHeight;
      const scrollY =
        window.scrollY || document.documentElement.scrollTop;
      const actual = measure(scrollY, totalAfter);
      if (
        totalAfter === total &&
        scrollY === targetY &&
        actual === targetPercent
      ) {
        return actual;
      }
      growSpacer(2);
    }

    const total = getTotal();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const actual = measure(scrollY, total);
    throw new Error(
      "scrollToExactPercent: ちょうど " +
        targetPercent +
        "% にできなかった (actual=" +
        actual +
        ", total=" +
        total +
        ", scrollY=" +
        scrollY +
        ")"
    );
  })(${JSON.stringify(percent)})`);

  if (measured !== percent) {
    throw new Error(
      `scrollToExactPercent: Node 側検証失敗 measured=${measured} want=${percent}`
    );
  }
  return measured;
}

/** ページ先頭までスクロールする。 */
export async function scrollToTop(page: E2ePage): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** カーソルがビューポート上端の外へ出る動きを合成する。 */
export async function simulateExitIntent(page: E2ePage): Promise<void> {
  await page.evaluate(`(() => {
    const event = new MouseEvent("mouseout", {
      bubbles: true,
      cancelable: true,
      clientY: -5,
      relatedTarget: null,
      view: window,
    });
    Object.defineProperty(event, "relatedTarget", {
      get: function () { return null; },
    });
    document.dispatchEvent(event);
  })()`);
}

/** 離脱インテントにならない mouseout を合成する。 */
export async function simulateNonExitMouseout(page: E2ePage): Promise<void> {
  await page.evaluate(`(() => {
    const event = new MouseEvent("mouseout", {
      bubbles: true,
      cancelable: true,
      clientY: 10,
      relatedTarget: null,
      view: window,
    });
    Object.defineProperty(event, "relatedTarget", {
      get: function () { return null; },
    });
    document.dispatchEvent(event);
  })()`);
}

/** spa.html の「注文完了」ボタンをクリックする。 */
export async function clickSpaOrderComplete(page: E2ePage): Promise<void> {
  await page
    .getByRole("button", { name: "注文完了(SPA遷移でURL到達)" })
    .click();
}

/** spa.html の手動ページビューボタンをクリックする。 */
export async function clickManualPageview(page: E2ePage): Promise<void> {
  await page
    .getByRole("button", { name: "dataLayer で手動ページビュー送信" })
    .click();
}

/** tdDataLayer.push({event:'tracker.pageview'}) を単独で発火する。 */
export async function pushTdDataLayerPageview(page: E2ePage): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { tdDataLayer?: { push: (i: unknown) => void } }
    ).tdDataLayer?.push({
      event: "tracker.pageview",
    });
  });
}

/** 先行dataLayer queueを準備し、tracker.jsの停止確認後に読み込みを再開する。 */
export async function gotoDemoPageWithPreloadedDataLayerQueue(
  session: ManagedSession,
  page: E2ePage,
  path: string
): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { tdDataLayer?: unknown[] }).tdDataLayer = [
      { event: "tracker.pageview" },
    ];
  });
  await gotoDemoPageWithTrackerScriptGate(session, page, path);
}

/** モバイル exit_intent の非発火用入力を実行する。 */
export async function runExitIntentMobileAct(page: E2ePage): Promise<void> {
  await gotoDemoPageWithoutTrackerWait(page, "/");
  await page.locator("h1").tap();
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.locator("h1").tap();
}
