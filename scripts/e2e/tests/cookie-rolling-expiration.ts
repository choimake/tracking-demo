import { setTdCookie } from "../browser/index.js";
import { getDemoSiteOrigin } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  SHORT_MAX_AGE_SEC,
  SID_MAX_AGE_SEC,
  VID_MAX_AGE_SEC,
  assertCookieExpires,
  visitAndGetPageview,
} from "./cookie-helpers.js";

export async function testCookieRollingExpiration(
  ctx: E2eContext
): Promise<void> {
  await ctx.clearCookies();
  const first = await visitAndGetPageview(ctx, "/");
  for (const spec of [
    { name: "_td_sid" as const, value: first.sid, maxAge: SID_MAX_AGE_SEC },
    { name: "_td_vid" as const, value: first.vid, maxAge: VID_MAX_AGE_SEC },
  ]) {
    await setTdCookie(ctx.page, spec.name, spec.value, SHORT_MAX_AGE_SEC);
    const shortenedAt = Date.now() / 1000;
    const shortened = (await ctx.cookies(getDemoSiteOrigin())).find(
      (cookie) => cookie.name === spec.name
    );
    if (!shortened) throw new Error(`${spec.name} 短縮後にCookieがない`);
    assertCookieExpires(
      shortened,
      `${spec.name}(短縮後)`,
      SHORT_MAX_AGE_SEC,
      shortenedAt,
      ctx.browserName
    );
    const renewedAt = Date.now() / 1000;
    const hit = await visitAndGetPageview(ctx, "/products");
    if (hit.vid !== first.vid || hit.sid !== first.sid)
      throw new Error(`${spec.name} 再延長時に値が変わった`);
    const renewed = (await ctx.cookies(getDemoSiteOrigin())).find(
      (cookie) => cookie.name === spec.name
    );
    if (!renewed) throw new Error(`${spec.name} 再延長後にCookieがない`);
    assertCookieExpires(
      renewed,
      spec.name,
      spec.maxAge,
      renewedAt,
      ctx.browserName
    );
  }
}
