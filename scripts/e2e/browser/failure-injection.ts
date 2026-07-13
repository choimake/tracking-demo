import type { Request, Route } from "playwright";

import type { E2ePage, ManagedSession } from "../harness/types.js";

/** このモジュールは、通信障害とブラウザエラーの注入・観測を管理する。 */

const CONFIG_ROUTE_PATTERN = "**/api/config?*";
const COLLECT_ROUTE_PATTERN = "**/api/collect";
const TRACKER_SCRIPT_ROUTE_PATTERN = "**/tracker.js?*";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "content-type": "application/json",
};

export interface RequestProbe {
  readonly requests: Request[];
  dispose(): Promise<void>;
}

export interface PageErrorProbe {
  readonly errors: Error[];
  dispose(): void;
}

/** 全routeの解除完了を待ち、解除失敗は他routeを解除した後に報告する。 */
export async function disposeRequestProbes(
  ...probes: RequestProbe[]
): Promise<void> {
  const results = await Promise.allSettled(
    probes.map((probe) => probe.dispose())
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failures.length > 0) {
    throw new Error(
      `route解除が${failures.length}件失敗: ${failures.map((failure) => String(failure.reason)).join(" / ")}`
    );
  }
}

async function installRoute(
  session: ManagedSession,
  page: E2ePage,
  pattern: string,
  handle: (route: Route) => Promise<void>
): Promise<RequestProbe> {
  const requests: Request[] = [];
  const handler = async (route: Route): Promise<void> => {
    requests.push(route.request());
    await handle(route);
  };
  const routeId = await session.route(page, pattern, handler);
  return {
    requests,
    dispose: () => session.unroute(routeId),
  };
}

/** Config API を HTTP 500 に固定する。 */
export async function installConfigHttp500(
  session: ManagedSession,
  page: E2ePage
): Promise<RequestProbe> {
  return installRoute(session, page, CONFIG_ROUTE_PATTERN, (route) =>
    route.fulfill({
      body: JSON.stringify({ error: "E2E injected config failure" }),
      headers: CORS_HEADERS,
      status: 500,
    })
  );
}

/** Config をイベント0件で応答し、初回 pageview 以外の自動送信を止める。 */
export async function installEmptyConfig(
  session: ManagedSession,
  page: E2ePage
): Promise<RequestProbe> {
  return installRoute(session, page, CONFIG_ROUTE_PATTERN, (route) =>
    route.fulfill({
      body: JSON.stringify({ events: [] }),
      headers: CORS_HEADERS,
      status: 200,
    })
  );
}

/** Collect API の要求を観測し、実サーバーへ継続する。 */
export async function observeCollectRequests(
  session: ManagedSession,
  page: E2ePage
): Promise<RequestProbe> {
  return installRoute(session, page, COLLECT_ROUTE_PATTERN, (route) =>
    route.continue()
  );
}

/** Collect API を HTTP 500 に固定する。 */
export async function installCollectHttp500(
  session: ManagedSession,
  page: E2ePage
): Promise<RequestProbe> {
  return installRoute(session, page, COLLECT_ROUTE_PATTERN, (route) =>
    route.fulfill({
      body: JSON.stringify({ error: "E2E injected collect failure" }),
      headers: CORS_HEADERS,
      status: 500,
    })
  );
}

/** tracker.js を HTTP 404 に固定する。 */
export async function installTrackerScriptHttp404(
  session: ManagedSession,
  page: E2ePage
): Promise<RequestProbe> {
  return installRoute(session, page, TRACKER_SCRIPT_ROUTE_PATTERN, (route) =>
    route.fulfill({
      body: "",
      headers: { "access-control-allow-origin": "*" },
      status: 404,
    })
  );
}

/** 対象 API の要求がないことを観測する。予期せぬ要求は実サーバーへ継続する。 */
export async function observeConfigRequests(
  session: ManagedSession,
  page: E2ePage
): Promise<RequestProbe> {
  return installRoute(session, page, CONFIG_ROUTE_PATTERN, (route) =>
    route.continue()
  );
}

export function observePageErrors(page: E2ePage): PageErrorProbe {
  const errors: Error[] = [];
  const handler = (error: Error): void => {
    errors.push(error);
  };
  page.on("pageerror", handler);
  return {
    errors,
    dispose: () => page.off("pageerror", handler),
  };
}

/** sendBeacon を false 応答に固定し、tracker の fetch fallback を選択させる。 */
export async function forceSendBeaconFalse(page: E2ePage): Promise<void> {
  // page.addInitScript は tsx の __name 変換を避けるため文字列で実行する。
  await page.addInitScript(`(() => {
    Object.defineProperty(Navigator.prototype, "sendBeacon", {
      configurable: true,
      value: () => false,
    });
  })()`);
}

/** Config 失敗後の非破壊性を確認する識別要素をロード前 queue に積む。 */
export async function preloadFailureQueueSentinel(
  page: E2ePage
): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { tdDataLayer?: unknown[] }).tdDataLayer = [
      { event: "e2e.config-failure-sentinel" },
    ];
  });
}

/** Config 失敗後も queue が識別要素を保持し、push 可能であることを確認する。 */
export async function inspectFailureQueue(page: E2ePage): Promise<{
  pushAddedItem: boolean;
  sentinelPresent: boolean;
}> {
  return page.evaluate(() => {
    const dataLayer = (window as unknown as { tdDataLayer?: unknown[] })
      .tdDataLayer;
    if (!Array.isArray(dataLayer)) {
      return { pushAddedItem: false, sentinelPresent: false };
    }
    const sentinelPresent = dataLayer.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "event" in item &&
        item.event === "e2e.config-failure-sentinel"
    );
    const lengthBefore = dataLayer.length;
    dataLayer.push({ event: "e2e.after-config-failure" });
    return {
      pushAddedItem: dataLayer.length === lengthBefore + 1,
      sentinelPresent,
    };
  });
}
