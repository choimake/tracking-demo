import { readDocumentCookie } from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import { expectAnonIdsPresent } from "../tracking/index.js";
import { snapshotTdCookies, visitAndGetPageview } from "./cookie-helpers.js";

export async function testCookieUnavailable(ctx: E2eContext): Promise<void> {
  await ctx.clearCookies();
  await visitAndGetPageview(ctx, "/");
  const before = await snapshotTdCookies(ctx);
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

  // initScripts は tsx の __name 変換を避けるため文字列で実行する。
  await ctx.withSession(
    {
      initScripts: [
        `(() => {
          Object.defineProperty(Document.prototype, "cookie", {
            configurable: true,
            get: () => "",
            set: () => undefined,
          });
        })()`,
      ],
    },
    async (session) => {
      await session.clearCookies();
      const first = await visitAndGetPageview(ctx, "/", session.page);
      const second = await visitAndGetPageview(ctx, "/products", session.page);
      expectAnonIdsPresent(first);
      expectAnonIdsPresent(second);
      if (first.vid === second.vid || first.sid === second.sid) {
        throw new Error("Cookie無効相当で匿名IDが継続した");
      }
    }
  );
  const after = await snapshotTdCookies(ctx);
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
