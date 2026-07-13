import type { E2ePage } from "../harness/types.js";

/** このモジュールは、同一文書内の History API と URL 状態を操作する。 */

/**
 * SPA上で任意パスへ history.pushState する(popstate は手動発火しない)。
 * tracker.js が history.pushState 自体をパッチして onHistoryChange を呼ぶため、
 * ここでは素の pushState を呼ぶだけでよい(手動で popstate も発火すると二重処理になる)
 */
export async function spaPushState(page: E2ePage, path: string): Promise<void> {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
  }, path);
}

/** SPA上で任意パスへ history.replaceState する。 */
export async function spaReplaceState(
  page: E2ePage,
  path: string
): Promise<void> {
  await page.evaluate((p) => {
    history.replaceState({}, "", p);
  }, path);
}

/** 同一ドキュメントの履歴を back 2回連続で移動する。 */
export async function goBackTwice(page: E2ePage): Promise<void> {
  await page.goBack();
  await page.goBack();
}

/** 同一ドキュメントの履歴を forward 2回連続で移動する。 */
export async function goForwardTwice(page: E2ePage): Promise<void> {
  await page.goForward();
  await page.goForward();
}

/** location.hash だけを変更する。hashchange はブラウザが発火する。 */
export async function changeLocationHash(
  page: E2ePage,
  hash: string
): Promise<void> {
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
}

/** 現在の pathname を維持し、history.pushState で query だけを変更する。 */
export async function changeQueryOnly(
  page: E2ePage,
  query: string
): Promise<void> {
  await page.evaluate((value) => {
    history.pushState({}, "", `${location.pathname}${value}${location.hash}`);
  }, query);
}

/** 現在の pathname で history.replaceState する。 */
export async function spaReplaceStateSamePath(page: E2ePage): Promise<void> {
  await page.evaluate(() => {
    history.replaceState({}, "", location.pathname);
  });
}

/** SPA遷移がページリロードを伴っていないことを検証するマーカーをセットする。 */
export async function setNoReloadMarker(page: E2ePage): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __no_reload_marker?: number }).__no_reload_marker =
      1;
  });
}

/** setNoReloadMarker でセットしたマーカーを読み出す。 */
export async function getNoReloadMarker(
  page: E2ePage
): Promise<number | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as { __no_reload_marker?: number }).__no_reload_marker
  );
}
