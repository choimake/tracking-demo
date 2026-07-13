import type { E2ePage } from "../harness/types.js";

/** このモジュールは、ページ文脈の匿名識別 Cookie を読み書きする。 */

/** document.cookie で匿名識別 Cookie をセットする。 */
export async function setTdCookie(
  page: E2ePage,
  name: "_td_vid" | "_td_sid",
  value: string,
  maxAge = 60
): Promise<void> {
  await page.evaluate(
    ({ cookieName, cookieValue, seconds }) => {
      document.cookie = `${cookieName}=${encodeURIComponent(cookieValue)}; Path=/; Max-Age=${seconds}; SameSite=Lax`;
    },
    { cookieName: name, cookieValue: value, seconds: maxAge }
  );
}

/** エンコードせずに匿名識別 Cookie をセットする。壊れたpercent encodingの検証専用。 */
export async function setRawTdCookie(
  page: E2ePage,
  name: "_td_vid" | "_td_sid",
  value: string,
  path = "/"
): Promise<void> {
  await page.evaluate(
    ({ cookieName, cookiePath, cookieValue }) => {
      document.cookie = `${cookieName}=${cookieValue}; Path=${cookiePath}; Max-Age=60; SameSite=Lax`;
    },
    { cookieName: name, cookiePath: path, cookieValue: value }
  );
}

/** document.cookie から指定した匿名識別 Cookie を削除する。 */
export async function deleteTdCookies(
  page: E2ePage,
  names: ("_td_vid" | "_td_sid")[]
): Promise<void> {
  await page.evaluate((cookieNames) => {
    for (const name of cookieNames) {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
  }, names);
}

/** 現在のページから document.cookie を直接読み取る。 */
export async function readDocumentCookie(page: E2ePage): Promise<string> {
  return page.evaluate(() => document.cookie);
}
