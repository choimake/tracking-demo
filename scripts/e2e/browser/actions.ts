import type { Page } from "playwright";

import {
  DEMO_SITE_ORIGIN,
  DEFAULT_WAIT_TIMEOUT_MS,
} from "../harness/config.js";
import { sleep } from "../tracking/assertions.js";

/** demo-site のページへ遷移する(path は先頭スラッシュ付き。例: '/', '/products') */
export async function gotoDemoPage(page: Page, path: string): Promise<void> {
  // Firefox では networkidle がハングしやすい。
  // 「初期化完了」ではなく pageview 送信後まで待ち、直後の sinceMs 計測に初期PVが食い込まないようにする
  const pageviewDone = page.waitForEvent("console", {
    predicate: (m) => m.text().includes("[tracker] ページビュー:"),
    timeout: DEFAULT_WAIT_TIMEOUT_MS,
  });
  await page.goto(`${DEMO_SITE_ORIGIN}${path}`, { waitUntil: "load" });
  await pageviewDone;
}

/** products.html の「カートに入れる」ボタン(クリックトリガー: click:.add-to-cart)をクリック */
export async function clickAddToCart(page: Page): Promise<void> {
  await page.getByRole("button", { name: "カートに入れる" }).first().click();
}

/** ページ最下部までスクロールし、スクロール率トリガーを発火させる */
export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight)
  );
}

/** ページ先頭までスクロールする(再スクロールでの再発火なしを検証するため) */
export async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** カーソルがビューポート上端の外へ出る動きを合成イベントで再現し、離脱インテントを発火させる */
export async function simulateExitIntent(page: Page): Promise<void> {
  // page.evaluate に渡す関数は tsx の __name 変換を避けるため文字列で実行する
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

/** spa.html の「注文完了(SPA遷移でURL到達)」ボタンをクリック(pushState による疑似遷移) */
export async function clickSpaOrderComplete(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "注文完了(SPA遷移でURL到達)" })
    .click();
}

/**
 * SPA上で任意パスへ history.pushState する(popstate は手動発火しない)。
 * tracker.js が history.pushState 自体をパッチして onHistoryChange を呼ぶため、
 * ここでは素の pushState を呼ぶだけでよい(手動で popstate も発火すると二重処理になる)
 */
export async function spaPushState(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
  }, path);
}

/** spa.html の「dataLayer で手動ページビュー送信」ボタンをクリック */
export async function clickManualPageview(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "dataLayer で手動ページビュー送信" })
    .click();
}

/** tdDataLayer.push({event:'tracker.pageview'}) のみを単独で発火する */
export async function pushTdDataLayerPageview(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { tdDataLayer?: { push: (i: unknown) => void } }
    ).tdDataLayer?.push({
      event: "tracker.pageview",
    });
  });
}

/** SPA遷移がページリロードを伴っていないことを検証するためのマーカーをセットする */
export async function setNoReloadMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __no_reload_marker?: number }).__no_reload_marker =
      1;
  });
}

/** setNoReloadMarker でセットしたマーカーを読み出す(リロードされていれば undefined に戻る) */
export async function getNoReloadMarker(
  page: Page
): Promise<number | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as { __no_reload_marker?: number }).__no_reload_marker
  );
}

/** tracker.js の読み込みを delayMs だけ遅延させるルートを設置する(ロード前キューの検証用) */
export async function delayTrackerScriptRoute(
  page: Page,
  delayMs: number
): Promise<void> {
  await page.route("**/tracker.js*", async (route) => {
    await sleep(delayMs);
    await route.continue();
  });
}

/** tracker.js 読み込み前に tdDataLayer へ pageview push を積んでおく(キュー再生の検証用) */
export async function preloadTdDataLayerQueue(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { tdDataLayer?: unknown[] }).tdDataLayer = [
      { event: "tracker.pageview" },
    ];
  });
}

/**
 * モバイル exit_intent 非発火用の Act。
 * タップ相当の操作のみ(合成 mouseout は使わない)。
 * body 全体をタップすると本文中のリンクに当たり遷移してしまうため、
 * リンクを含まない見出し(h1)を対象にする。
 * pageview コンソール待ちはしない(素の goto のまま)
 */
export async function runExitIntentMobileAct(page: Page): Promise<void> {
  await page.goto(`${DEMO_SITE_ORIGIN}/`, { waitUntil: "load" });
  await page.locator("h1").tap();
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.locator("h1").tap();
}
