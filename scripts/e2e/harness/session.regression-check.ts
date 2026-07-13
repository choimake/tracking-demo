/** managed session公開APIの型境界を固定する。実行時ブラウザは不要。 */
import type { BrowserContext, Page } from "playwright";

import type {
  E2eBrowserContextFactory,
  E2eContext,
  E2ePage,
  ManagedSession,
} from "./types.js";

type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;

type _NoRawRuntimeKeys = AssertNever<
  Extract<
    keyof E2eContext,
    "browser" | "createBrowserContext" | "recordVideoDir" | "scenarioVideoPath"
  >
>;
type _NoPageOwnershipKeys = AssertNever<
  Extract<
    keyof E2ePage,
    | "close"
    | "context"
    | "frames"
    | "mainFrame"
    | "opener"
    | "route"
    | "unroute"
    | "video"
  >
>;
type _ContextFactoryIsInternalRawType = AssertTrue<
  Awaited<ReturnType<E2eBrowserContextFactory>> extends BrowserContext
    ? true
    : false
>;
type _ManagedPageKeepsPageOperations = AssertTrue<
  E2ePage["goto"] extends (...args: Parameters<Page["goto"]>) => Promise<void>
    ? true
    : false
>;
type _ContextHasManagedSession = AssertTrue<
  E2eContext extends ManagedSession ? true : false
>;
type _MobileRequired = AssertTrue<
  E2eContext["mobile"] extends boolean ? true : false
>;

const checks: [
  _NoRawRuntimeKeys,
  _NoPageOwnershipKeys,
  _ContextFactoryIsInternalRawType,
  _ManagedPageKeepsPageOperations,
  _ContextHasManagedSession,
  _MobileRequired,
] = [undefined as never, undefined as never, true, true, true, true];

void checks;
