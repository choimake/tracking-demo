/** E2E で直列実行する Playwright ブラウザ名。 */
export type BrowserName = "chromium" | "firefox" | "webkit";

const ALL_BROWSERS: BrowserName[] = ["chromium", "firefox", "webkit"];

/** `E2E_MOBILE=1` 等の truthy 値でモバイルコンテキスト実行にする。 */
export function isE2eMobile(): boolean {
  const value = process.env.E2E_MOBILE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * `E2E_BROWSERS=chromium` または `chromium,firefox` で project を絞る。
 * 未設定時は全ブラウザ。不正な名前は Error。
 */
export function parseE2eBrowsers(): BrowserName[] {
  const raw = process.env.E2E_BROWSERS?.trim();
  if (!raw) {
    return [...ALL_BROWSERS];
  }
  const names = raw.split(",").map((name) => name.trim().toLowerCase());
  const result: BrowserName[] = [];
  for (const name of names) {
    if (name !== "chromium" && name !== "firefox" && name !== "webkit") {
      throw new Error(
        `未知の E2E_BROWSERS 値: ${name} (chromium|firefox|webkit)`
      );
    }
    if (!result.includes(name)) {
      result.push(name);
    }
  }
  if (result.length === 0) {
    throw new Error("E2E_BROWSERS が空です");
  }
  return result;
}
