import { setRawTdCookie, setTdCookie } from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import { assertValidIdentity, visitAndGetPageview } from "./cookie-helpers.js";

export async function testCookieInvalidValues(ctx: E2eContext): Promise<void> {
  await ctx.page.context().clearCookies();
  const first = await visitAndGetPageview(ctx, "/");
  await setTdCookie(ctx.page, "_td_sid", "not-a-valid-sid");
  const sidRecovered = await visitAndGetPageview(ctx, "/products");
  assertValidIdentity(sidRecovered.vid, sidRecovered.sid);
  if (
    sidRecovered.vid !== first.vid ||
    sidRecovered.sid === "not-a-valid-sid"
  ) {
    throw new Error("不正sidから正しく回復しない");
  }

  await setTdCookie(ctx.page, "_td_vid", "not-a-valid-vid");
  await setTdCookie(ctx.page, "_td_sid", "also-invalid");
  const bothRecovered = await visitAndGetPageview(ctx, "/");
  assertValidIdentity(bothRecovered.vid, bothRecovered.sid);
  if (
    bothRecovered.vid === "not-a-valid-vid" ||
    bothRecovered.sid === "also-invalid"
  ) {
    throw new Error("不正vid/sidから正しく回復しない");
  }

  await setRawTdCookie(ctx.page, "_td_vid", "%");
  await setRawTdCookie(ctx.page, "_td_sid", "%E0%A4%A");
  const malformedEncodingRecovered = await visitAndGetPageview(
    ctx,
    "/products"
  );
  assertValidIdentity(
    malformedEncodingRecovered.vid,
    malformedEncodingRecovered.sid
  );

  const rootVid = malformedEncodingRecovered.vid;
  await setRawTdCookie(
    ctx.page,
    "_td_vid",
    "v_00000000-0000-4000-8000-000000000000",
    "/products"
  );
  const pathCollision = await visitAndGetPageview(ctx, "/products");
  if (pathCollision.vid !== rootVid) {
    throw new Error("異なるPathの同名CookieがPath=/のvidを上書きした");
  }
}
