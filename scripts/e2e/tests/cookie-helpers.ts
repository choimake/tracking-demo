import type { Cookie, Page } from "playwright";

import { gotoDemoPage } from "../browser/index.js";
import { DEMO_SITE_ORIGIN, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { BrowserName } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  ANON_SID_RE,
  ANON_VID_RE,
  expectHitPayload,
  expectPageviewCountAtLeast,
  waitForNewHit,
} from "../tracking/index.js";

export const VID_MAX_AGE_SEC = 2 * 365 * 24 * 60 * 60;
export const SID_MAX_AGE_SEC = 30 * 60;
export const SHORT_MAX_AGE_SEC = 60;
const BROWSER_COOKIE_CAP_SEC = 400 * 24 * 60 * 60;
const ITP_COOKIE_CAP_SEC = 7 * 24 * 60 * 60;
const EXPIRES_TOLERANCE_SEC = 120;

export function assertDemoCookieAttrs(cookie: Cookie, name: string): void {
  if (cookie.path !== "/" || cookie.sameSite !== "Lax") {
    throw new Error(`${name} の Path/SameSite 属性が不正`);
  }
  if (cookie.secure || cookie.httpOnly) {
    throw new Error(`${name} の Secure/HttpOnly 属性がデモ仕様と不一致`);
  }
}

export function assertCookieExpires(
  cookie: Cookie,
  name: string,
  maxAgeSec: number,
  issuedAtSec: number,
  browserName: BrowserName
): void {
  const caps = [maxAgeSec, Math.min(maxAgeSec, BROWSER_COOKIE_CAP_SEC)];
  if (browserName === "webkit") {
    caps.push(Math.min(maxAgeSec, ITP_COOKIE_CAP_SEC));
  }
  if (
    !caps.some(
      (seconds) =>
        Math.abs(cookie.expires - (issuedAtSec + seconds)) <=
        EXPIRES_TOLERANCE_SEC
    )
  ) {
    throw new Error(`${name} expires が Max-Age=${maxAgeSec}s 相当でない`);
  }
}

export async function snapshotTdCookies(page: Page): Promise<{
  sid: string | undefined;
  vid: string | undefined;
}> {
  const cookies = await page.context().cookies(DEMO_SITE_ORIGIN);
  return {
    sid: cookies.find((cookie) => cookie.name === "_td_sid")?.value,
    vid: cookies.find((cookie) => cookie.name === "_td_vid")?.value,
  };
}

export async function visitAndGetPageview(
  ctx: E2eContext,
  path: string,
  page: Page = ctx.page
) {
  const cursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(page, path);
  await expectPageviewCountAtLeast(ctx.tracking, cursor, 1, `${path} pageview`);
  return waitForNewHit(
    ctx.tracking,
    { afterHitId: cursor, eventId: null, type: "pageview" },
    `${path} pageview Hit`
  );
}

export function assertPageviewIdentity(
  ctx: E2eContext,
  hit: Awaited<ReturnType<typeof visitAndGetPageview>>,
  expected?: { sid?: string; vid?: string; path?: string }
): void {
  expectHitPayload(hit, {
    eventId: null,
    sid: expected?.sid,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: expected?.path,
    vid: expected?.vid,
    workspaceId: WORKSPACE_ID,
  });
}

export function assertValidIdentity(vid: string, sid: string): void {
  if (!ANON_VID_RE.test(vid) || !ANON_SID_RE.test(sid)) {
    throw new Error(`匿名ID形式が不正: vid=${vid} sid=${sid}`);
  }
}
