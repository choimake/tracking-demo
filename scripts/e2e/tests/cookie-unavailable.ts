import { readDocumentCookie } from "../browser/index.js";
import { createE2eSession } from "../harness/session.js";
import type { E2eContext } from "../harness/types.js";
import { expectAnonIdsPresent, quiesceBeacons } from "../tracking/index.js";
import { snapshotTdCookies, visitAndGetPageview } from "./cookie-helpers.js";

export async function testCookieUnavailable(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  await ctx.page.context().clearCookies();
  await visitAndGetPageview(ctx, "/");
  const before = await snapshotTdCookies(ctx.page);
  if (!before.vid || !before.sid) throw new Error("汚染検証用Cookieがない");
  const documentCookieBefore = await readDocumentCookie(ctx.page);
  if (
    !documentCookieBefore.includes(`_td_vid=${before.vid}`) ||
    !documentCookieBefore.includes(`_td_sid=${before.sid}`)
  ) {
    throw new Error(
      `開始前にdocument.cookieから匿名IDを読めない: ${documentCookieBefore}`
    );
  }

  const session = await createE2eSession(ctx.browser, {
    browserName: ctx.browserName,
    correlationId: ctx.correlationId,
    userAgent: ctx.userAgent,
  });
  try {
    await session.context.addInitScript(() => {
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get: () => "",
        set: () => undefined,
      });
    });
    await session.context.clearCookies();
    const first = await visitAndGetPageview(ctx, "/", session.page);
    const second = await visitAndGetPageview(ctx, "/products", session.page);
    expectAnonIdsPresent(first);
    expectAnonIdsPresent(second);
    if (first.vid === second.vid || first.sid === second.sid) {
      throw new Error("Cookie無効相当で匿名IDが継続した");
    }
  } finally {
    await session.context.close();
  }
  const after = await snapshotTdCookies(ctx.page);
  if (after.vid !== before.vid || after.sid !== before.sid) {
    throw new Error("Cookie無効化用contextがシナリオcontextを汚染した");
  }
  const documentCookieAfter = await readDocumentCookie(ctx.page);
  if (
    !documentCookieAfter.includes(`_td_vid=${before.vid}`) ||
    !documentCookieAfter.includes(`_td_sid=${before.sid}`)
  ) {
    throw new Error(
      `終了後にdocument.cookieから匿名IDを読めない: ${documentCookieAfter}`
    );
  }
}
