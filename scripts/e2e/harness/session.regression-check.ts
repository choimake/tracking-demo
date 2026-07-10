/**
 * createE2ePage / createE2eSession の公開 API が context を含むことの型レベル assert。
 * 実行時ブラウザは不要。`npm run typecheck` で検証される。
 */
import type { Browser, BrowserContext, Page } from "playwright";

import type { TrackingClient } from "../tracking/client.js";
import type { createE2ePage, createE2eSession, E2eSession } from "./session.js";
import type { E2eContext } from "./types.js";

type AwaitedReturn<T> = T extends (...args: never[]) => Promise<infer R>
  ? R
  : never;

type SessionFromCreate = AwaitedReturn<typeof createE2eSession>;
type SessionFromPage = AwaitedReturn<typeof createE2ePage>;

type AssertEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T,
>() => T extends B ? 1 : 2
  ? true
  : false;

type _SessionEqualsPage = AssertEqual<SessionFromCreate, SessionFromPage>;
type _SessionEqualsInterface = AssertEqual<SessionFromCreate, E2eSession>;
type _ContextRequired = E2eSession["context"] extends BrowserContext
  ? true
  : false;
type _PageRequired = E2eSession["page"] extends Page ? true : false;
type _TrackingRequired = E2eSession["tracking"] extends TrackingClient
  ? true
  : false;
/** E2eContext.mobile は必須(boolean)。optional に戻すとここが落ちる */
type _E2eContextMobileRequired = E2eContext["mobile"] extends boolean
  ? true
  : false;

const _checks: [
  _SessionEqualsPage,
  _SessionEqualsInterface,
  _ContextRequired,
  _PageRequired,
  _TrackingRequired,
  _E2eContextMobileRequired,
] = [true, true, true, true, true, true];

// createE2ePage の戻り値から context を必須プロパティとして取り出せること
type _ContextFromPage = AwaitedReturn<typeof createE2ePage>["context"];
const _contextType: _ContextFromPage = null as unknown as BrowserContext;

// Browser 引数の型が一致すること(未使用でも型チェック対象)
type _BrowserArg = Parameters<typeof createE2ePage>[0];
const _browserArg: _BrowserArg = null as unknown as Browser;

void _checks;
void _contextType;
void _browserArg;
