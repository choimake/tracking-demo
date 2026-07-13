import {
  DEFAULT_WAIT_TIMEOUT_MS,
  getDemoSiteOrigin,
  registeredAbortSignal,
} from "../harness/config.js";
import type { E2ePage, ManagedSession } from "../harness/types.js";

/** このモジュールは、文書を読み込むナビゲーションと完了条件を管理する。 */

/** demo-site のページへ遷移する(path は先頭スラッシュ付き。例: '/', '/products') */
export async function gotoDemoPage(page: E2ePage, path: string): Promise<void> {
  // Firefox では networkidle がハングしやすい。
  // 「初期化完了」ではなく pageview 送信後まで待ち、Act 前の Hit カーソルを確定できるようにする。
  const pageviewDone = page.waitForEvent("console", {
    predicate: (m) => m.text().includes("[tracker] ページビュー:"),
    timeout: DEFAULT_WAIT_TIMEOUT_MS,
  });
  await page.goto(`${getDemoSiteOrigin()}${path}`, { waitUntil: "load" });
  await pageviewDone;
}

/** tracker の初期化完了を待たずにデモページを開く。 */
export async function gotoDemoPageWithoutTrackerWait(
  page: E2ePage,
  path: string
): Promise<void> {
  await page.goto(`${getDemoSiteOrigin()}${path}`, { waitUntil: "load" });
}

/** 現在のデモページを reload し、reload 後の pageview 送信まで待つ。 */
export async function reloadDemoPage(page: E2ePage): Promise<void> {
  const pageviewDone = page.waitForEvent("console", {
    predicate: (m) => m.text().includes("[tracker] ページビュー:"),
    timeout: DEFAULT_WAIT_TIMEOUT_MS,
  });
  await page.reload({ waitUntil: "load" });
  await pageviewDone;
}

/** 計測タグがない about:blank へ移動し、現在の計測ページから離脱する。 */
export async function leaveTrackedPage(page: E2ePage): Promise<void> {
  await page.goto("about:blank", { waitUntil: "load" });
}

/** tracker.js要求をrouteで停止し、停止確認後に読み込みを再開する。 */
export async function gotoDemoPageWithTrackerScriptGate(
  session: ManagedSession,
  page: E2ePage,
  path: string
): Promise<void> {
  let requestCount = 0;
  let releaseRoute!: () => void;
  let reportIntercepted!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    reportIntercepted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseRoute = resolve;
  });
  await session.route(page, "**/tracker.js*", async (route) => {
    requestCount += 1;
    reportIntercepted();
    await released;
    await route.continue();
  });
  const navigation = gotoDemoPage(page, path);
  let interceptionError: unknown;
  try {
    await Promise.race([
      intercepted,
      new Promise<never>((_resolve, reject) => {
        registeredAbortSignal(
          "tracker-route-interception-deadline"
        ).addEventListener(
          "abort",
          () => {
            reject(
              new Error(
                `tracker.js要求の停止待ちがtimeout: condition=requestCount >= 1; finalObserved=${JSON.stringify({ requestCount })}`
              )
            );
          },
          { once: true }
        );
      }),
    ]);
  } catch (error) {
    interceptionError = error;
  } finally {
    releaseRoute();
  }
  if (interceptionError !== undefined) {
    void navigation.catch(() => undefined);
    throw interceptionError;
  }
  try {
    await navigation;
  } catch (navigationError) {
    if (interceptionError === undefined) {
      throw navigationError;
    }
  }
}
