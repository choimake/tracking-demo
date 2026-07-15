import type { Cookie } from "playwright";

import { gotoDemoPage } from "../browser/index.js";
import {
  E2E_CORRELATION_UA_PREFIX,
  UA_TOKEN,
  WORKSPACE_ID,
  getDemoSiteOrigin,
} from "../harness/config.js";
import type { E2eContext, E2ePage, ManagedSession } from "../harness/types.js";
import {
  assertionError,
  expectAnonIdentityValues,
  expectFiredHit,
  expectHitPayload,
  quiesceBeacons,
} from "../tracking/index.js";

export const VID_MAX_AGE_SEC = 365 * 24 * 60 * 60;
export const SID_MAX_AGE_SEC = 30 * 60;
export const SHORT_MAX_AGE_SEC = 60;
const EXPIRES_TOLERANCE_SEC = 120;
const DUPLICATE_PAGEVIEW_VID = "v_00000000-0000-4000-8000-000000000001";
const DUPLICATE_PAGEVIEW_SID = "s_00000000-0000-4000-8000-000000000001";

export function assertDemoCookieAttrs(cookie: Cookie, name: string): void {
  if (cookie.path !== "/" || cookie.sameSite !== "Lax") {
    throw assertionError({
      actual: { path: cookie.path, sameSite: cookie.sameSite },
      context: { cookieName: name },
      expected: { path: "/", sameSite: "Lax" },
      name: "cookie-path-same-site",
      summary: `${name} の Path/SameSite 属性が不正`,
    });
  }
  if (cookie.secure || cookie.httpOnly) {
    throw assertionError({
      actual: { httpOnly: cookie.httpOnly, secure: cookie.secure },
      context: { cookieName: name },
      expected: { httpOnly: false, secure: false },
      name: "cookie-security-attributes",
      summary: `${name} の Secure/HttpOnly 属性がデモ仕様と不一致`,
    });
  }
}

// Max-Age はブラウザの切り詰め上限(WebKit(libsoup)=1年、Chrome/Firefox=400日)以下で設定する。
// このため期限はブラウザ共通の「発行時刻 + Max-Age」1本で検証できる。
export function assertCookieExpires(
  cookie: Cookie,
  name: string,
  maxAgeSec: number,
  issuedAtSec: number
): void {
  if (
    Math.abs(cookie.expires - (issuedAtSec + maxAgeSec)) > EXPIRES_TOLERANCE_SEC
  ) {
    throw assertionError({
      actual: { expires: cookie.expires },
      context: { cookieName: name, issuedAtSec },
      expected: { maxAgeSec, toleranceSec: EXPIRES_TOLERANCE_SEC },
      name: "cookie-expiration",
      summary: `${name} expires が Max-Age=${maxAgeSec}s 相当でない`,
    });
  }
}

export async function snapshotTdCookies(
  session: Pick<ManagedSession, "cookies">
): Promise<{
  sid: string | undefined;
  vid: string | undefined;
}> {
  const cookies = await session.cookies(getDemoSiteOrigin());
  return {
    sid: cookies.find((cookie) => cookie.name === "_td_sid")?.value,
    vid: cookies.find((cookie) => cookie.name === "_td_vid")?.value,
  };
}

export async function visitAndGetPageview(
  ctx: E2eContext,
  path: string,
  page: E2ePage = ctx.page
) {
  await quiesceBeacons(ctx.tracking);
  const injectDuplicatePageview =
    process.env.E2E_COOKIE_DUPLICATE_PAGEVIEW === "1";

  const { hit } = await expectFiredHit({
    act: async () => {
      // 先行Hitの後に正しいブラウザHitを送る。exact件数判定の失敗注入にだけ使う。
      if (injectDuplicatePageview) {
        await ctx.tracking.fetchTracking("/api/collect", {
          body: JSON.stringify({
            sid: DUPLICATE_PAGEVIEW_SID,
            type: "pageview",
            ua: `${ctx.userAgent} ${E2E_CORRELATION_UA_PREFIX}${ctx.correlationId}`,
            url: `${getDemoSiteOrigin()}${path}`,
            vid: DUPLICATE_PAGEVIEW_VID,
            ws: WORKSPACE_ID,
          }),
          method: "POST",
        });
      }
      await gotoDemoPage(page, path);
    },
    exactCount: {
      expectedCount: 1,
      kind: "hit-count",
      label: `${path} pageview`,
    },
    expectedPayload: {
      eventId: null,
      type: "pageview",
      uaIncludes: UA_TOKEN[ctx.browserName],
      urlIncludes: path,
      workspaceId: WORKSPACE_ID,
    },
    filter: { eventId: null, type: "pageview" },
    hitLabel: `${path} pageview Hit`,
    tracking: ctx.tracking,
  });
  return hit;
}

export function assertPageviewIdentity(
  ctx: E2eContext,
  hit: Awaited<ReturnType<typeof visitAndGetPageview>>,
  expected?: { sid?: string; vid?: string; path?: string }
): void {
  const expectedPath = expected?.path;
  const expectedSid = expected?.sid;
  const expectedVid = expected?.vid;
  expectHitPayload(hit, {
    eventId: null,
    ...(expectedSid === undefined ? {} : { sid: expectedSid }),
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    ...(expectedPath === undefined ? {} : { urlIncludes: expectedPath }),
    ...(expectedVid === undefined ? {} : { vid: expectedVid }),
    workspaceId: WORKSPACE_ID,
  });
}

export function assertValidIdentity(vid: string, sid: string): void {
  expectAnonIdentityValues(vid, sid);
}
