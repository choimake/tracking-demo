import { deleteTdCookies } from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import { ANON_SID_RE } from "../tracking/index.js";
import { visitAndGetPageview } from "./cookie-helpers.js";

export async function testCookieSessionReset(ctx: E2eContext): Promise<void> {
  await ctx.page.context().clearCookies();
  const first = await visitAndGetPageview(ctx, "/");
  await deleteTdCookies(ctx.page, ["_td_sid"]);
  const reset = await visitAndGetPageview(ctx, "/products");
  if (
    reset.vid !== first.vid ||
    reset.sid === first.sid ||
    !ANON_SID_RE.test(reset.sid)
  ) {
    throw new Error("sid削除後の匿名ID契約が不正");
  }
}
