import { deleteTdCookies } from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import { quiesceBeacons } from "../tracking/index.js";
import { assertValidIdentity, visitAndGetPageview } from "./cookie-helpers.js";

export async function testCookieClientReset(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  await ctx.page.context().clearCookies();
  const first = await visitAndGetPageview(ctx, "/");
  await deleteTdCookies(ctx.page, ["_td_vid", "_td_sid"]);
  const reset = await visitAndGetPageview(ctx, "/products");
  assertValidIdentity(reset.vid, reset.sid);
  if (reset.vid === first.vid || reset.sid === first.sid)
    throw new Error("client reset後も旧匿名IDが残った");
}
