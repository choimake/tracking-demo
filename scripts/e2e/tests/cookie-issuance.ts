import { DEMO_SITE_ORIGIN } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  SID_MAX_AGE_SEC,
  VID_MAX_AGE_SEC,
  assertCookieExpires,
  assertDemoCookieAttrs,
  assertPageviewIdentity,
  assertValidIdentity,
  visitAndGetPageview,
} from "./cookie-helpers.js";

export async function testCookieIssuance(ctx: E2eContext): Promise<void> {
  await ctx.clearCookies();
  const issuedAt = Date.now() / 1000;
  const hit = await visitAndGetPageview(ctx, "/");
  assertValidIdentity(hit.vid, hit.sid);
  assertPageviewIdentity(ctx, hit, { sid: hit.sid, vid: hit.vid });
  const cookies = await ctx.cookies(DEMO_SITE_ORIGIN);
  const vid = cookies.find((cookie) => cookie.name === "_td_vid");
  const sid = cookies.find((cookie) => cookie.name === "_td_sid");
  if (!vid || vid.value !== hit.vid || !sid || sid.value !== hit.sid) {
    throw new Error("発行 Cookie と初回 Hit の匿名IDが一致しない");
  }
  assertDemoCookieAttrs(vid, "_td_vid");
  assertDemoCookieAttrs(sid, "_td_sid");
  assertCookieExpires(
    vid,
    "_td_vid",
    VID_MAX_AGE_SEC,
    issuedAt,
    ctx.browserName
  );
  assertCookieExpires(
    sid,
    "_td_sid",
    SID_MAX_AGE_SEC,
    issuedAt,
    ctx.browserName
  );
}
