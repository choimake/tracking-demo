import type {
  BrowserContext,
  BrowserContextOptions,
  Cookie,
  Locator,
  Page,
  Route,
} from "playwright";

import type { TrackingClient } from "../tracking/client.js";
import type { BrowserName } from "./config.js";

export type { EventSummary, HitRecord } from "../tracking/client.js";
export type { BrowserName } from "./config.js";

/** runtime が BrowserContext を生成するために使う内部factory。 */
export type E2eBrowserContextFactory = (
  options?: BrowserContextOptions
) => Promise<BrowserContext>;

declare const managedPageBrand: unique symbol;

export interface E2eConsoleMessage {
  text(): string;
}

/** browser Actだけが利用するLocator capability。Pageへ戻る操作は含まない。 */
export interface E2eLocator {
  click(...args: Parameters<Locator["click"]>): Promise<void>;
  first(): E2eLocator;
  locator(...args: Parameters<Locator["locator"]>): E2eLocator;
  tap(...args: Parameters<Locator["tap"]>): Promise<void>;
}

/** シナリオへ渡すPage capability。Playwrightの所有資源へ戻る操作は含まない。 */
export interface E2ePage {
  readonly [managedPageBrand]: true;
  addInitScript: Page["addInitScript"];
  addScriptTag(...args: Parameters<Page["addScriptTag"]>): Promise<void>;
  evaluate: Page["evaluate"];
  getByRole(...args: Parameters<Page["getByRole"]>): E2eLocator;
  goBack(...args: Parameters<Page["goBack"]>): Promise<void>;
  goForward(...args: Parameters<Page["goForward"]>): Promise<void>;
  goto(...args: Parameters<Page["goto"]>): Promise<void>;
  locator(...args: Parameters<Page["locator"]>): E2eLocator;
  off(event: "pageerror", listener: (error: Error) => void): void;
  on(event: "pageerror", listener: (error: Error) => void): void;
  reload(...args: Parameters<Page["reload"]>): Promise<void>;
  waitForEvent(
    event: "console",
    options?: {
      predicate?: (message: E2eConsoleMessage) => boolean | Promise<boolean>;
      timeout?: number;
    }
  ): Promise<E2eConsoleMessage>;
}

export type E2eRoutePattern = Parameters<Page["route"]>[0];
export type E2eRouteHandler = (route: Route) => Promise<void>;

/** managed sessionが生成する特殊contextの指定。 */
export interface ManagedSessionOptions {
  /** context生成直後に登録する初期化script。 */
  initScripts?: readonly string[];
  /** モバイル viewport / hasTouch / isMobile(Firefox以外)を付与する。 */
  mobile?: boolean;
  /** 内側sessionの動画をシナリオ動画として確定する。 */
  recordScenarioVideo?: boolean;
}

/** シナリオが利用できるmanaged sessionの最小capability。 */
export interface ManagedSession {
  /** runtimeが所有する既定page。 */
  page: E2ePage;
  /** 同じcontextにpageを追加する。runtimeがsession終了時に解放する。 */
  newPage(): Promise<E2ePage>;
  /** 当該contextのCookieを削除する。 */
  clearCookies(): Promise<void>;
  /** 当該contextのCookieを取得する。 */
  cookies(urls?: string | readonly string[]): Promise<Cookie[]>;
  /** primary pageへPlaywright Clockを導入し、自動進行を停止する。 */
  installClock(): Promise<void>;
  /** 停止中のClockを指定ミリ秒だけ進める。自動進行は再開しない。 */
  advanceClockBy(durationMs: number): Promise<void>;
  /** routeをID付きで登録する。runtimeがsession終了時に未解除routeを解除する。 */
  route(
    page: E2ePage,
    pattern: E2eRoutePattern,
    handler: E2eRouteHandler
  ): Promise<string>;
  /** 登録済みrouteを解除する。解除済みIDへの再呼び出しは成功する。 */
  unroute(routeId: string): Promise<void>;
}

/** setupE2eFixtures が作成し、全テストケースで共有する検証用データ */
export interface E2eFixtures {
  /** 検証用に作成した離脱インテントイベントのID */
  exitIntentEventId: string;
  /** 検証用に作成した「滞在2秒」イベントのID */
  timeOnPageEventId: string;
  /** 検証用に作成した日本語URL到達(`url:/注文/完了`)イベントのID */
  japaneseUrlEventId: string;
}

/** 各テストケース関数に渡される実行コンテキスト。 */
export interface E2eContext extends ManagedSession {
  browserName: BrowserName;
  /** run・browser・scenario を一意に識別する E2E 相関 ID */
  correlationId: string;
  /** 相関トークンを付ける前のブラウザ User-Agent */
  userAgent: string;
  /** ページの console から収集した "[tracker]" 始まりのログ */
  trackerLogs: string[];
  tracking: TrackingClient;
  fixtures: E2eFixtures;
  /** E2E_MOBILE 相当。外側 session がモバイルcontextかどうか。 */
  mobile: boolean;
  /** 追加contextをcallback内だけ公開し、終了時に全資源を解放する。 */
  withSession<T>(
    options: ManagedSessionOptions,
    callback: (session: ManagedSession) => Promise<T>
  ): Promise<T>;
}
