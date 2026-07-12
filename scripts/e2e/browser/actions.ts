import type { Page } from "playwright";

import {
  DEMO_SITE_ORIGIN,
  DEFAULT_WAIT_TIMEOUT_MS,
  sleep,
} from "../harness/config.js";

/** demo-site のページへ遷移する(path は先頭スラッシュ付き。例: '/', '/products') */
export async function gotoDemoPage(page: Page, path: string): Promise<void> {
  // Firefox では networkidle がハングしやすい。
  // 「初期化完了」ではなく pageview 送信後まで待ち、Act 前の Hit カーソルを確定できるようにする。
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

/**
 * `.add-to-cart` ボタン内の子要素をクリックする(closest vs matches 殺傷用)。
 * closest('.add-to-cart') なら発火、matches なら未発火。
 */
export async function clickAddToCartChild(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "カートに入れる" })
    .first()
    .locator("span")
    .click();
}

/** ページ最下部までスクロールし、スクロール率トリガーを発火させる */
export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight)
  );
}

/**
 * スクロール率をちょうど percent% にする(境界変異 `>=`→`>` 殺傷用)。
 * 整数条件 `scrollY * 100 === total * percent` を満たす高さへ調整し、
 * tracker と同式 `(scrollY/total)*100` の実測値を Node 側へ返して === 検証する。
 * page.evaluate に渡す関数は tsx の __name 変換を避けるため文字列で実行する。
 */
export async function scrollToExactPercent(
  page: Page,
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

    // 探索中はスクロールしない(閾値を超えて誤発火させない)。高さだけ調整する
    for (let attempt = 0; attempt < 100; attempt++) {
      const total = getTotal();
      // 整数条件: scrollY * 100 === total * targetPercent
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

/**
 * 離脱インテントにならない mouseout を合成する(clientY > 0 ガード殺傷用)。
 * relatedTarget は null、clientY は正(ビューポート内)。
 */
export async function simulateNonExitMouseout(page: Page): Promise<void> {
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

/** location.hash だけを変更する。hashchange はブラウザが発火する。 */
export async function changeLocationHash(
  page: Page,
  hash: string
): Promise<void> {
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
}

/** 現在の pathname を維持し、history.pushState で query だけを変更する。 */
export async function changeQueryOnly(
  page: Page,
  query: string
): Promise<void> {
  await page.evaluate((value) => {
    history.pushState({}, "", `${location.pathname}${value}${location.hash}`);
  }, query);
}

/**
 * 現在の pathname で history.replaceState する(同一パス早期 return 殺傷用)。
 * 正規実装では追加 pageview なし。早期 return 削除変異では +1 になる。
 */
export async function spaReplaceStateSamePath(page: Page): Promise<void> {
  await page.evaluate(() => {
    history.replaceState({}, "", location.pathname);
  });
}

/**
 * document.cookie で `_td_sid` をセットする(形式不正 sid の再発行検証用)。
 * テスト本体への evaluate 直書きを避ける。
 */
export async function setTdSidCookie(
  page: Page,
  sid: string,
  maxAgeSec = 30 * 60
): Promise<void> {
  await page.evaluate(
    ({ maxAge, value }) => {
      document.cookie = `_td_sid=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    },
    { maxAge: maxAgeSec, value: sid }
  );
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
