import { gotoDemoPage, openSiblingTab } from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectPageviewCountExactly,
  quiesceBeacons,
  waitForNewHit,
} from "../tracking/index.js";
import {
  assertPageviewIdentity,
  snapshotTdCookies,
  visitAndGetPageview,
} from "./cookie-helpers.js";
export async function testCookieMultitab(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  await ctx.page.context().clearCookies();
  const sibling = await openSiblingTab(ctx.page);
  try {
    const cursor = await ctx.tracking.captureHitCursor();
    await Promise.all([
      gotoDemoPage(ctx.page, "/"),
      gotoDemoPage(sibling, "/spa"),
    ]);
    await expectPageviewCountExactly(
      ctx.tracking,
      cursor,
      2,
      "複数タブの同時pageview"
    );
    const latestInitialHit = await waitForNewHit(
      ctx.tracking,
      { afterHitId: cursor, eventId: null, type: "pageview" },
      "複数タブ初期化のpageview Hit"
    );
    const latestInitialPath = new URL(latestInitialHit.url).pathname;
    if (latestInitialPath !== "/" && latestInitialPath !== "/spa") {
      throw new Error(`複数タブ初期化のHit URLが不正: ${latestInitialPath}`);
    }
    assertPageviewIdentity(ctx, latestInitialHit, {
      path: latestInitialPath,
    });
    const hits = await ctx.tracking.getHitsMatching({
      afterHitId: cursor,
      eventId: null,
      type: "pageview",
    });
    const firstTab = hits.find((hit) => new URL(hit.url).pathname === "/");
    const secondTab = hits.find((hit) => hit.url.includes("/spa"));
    if (!firstTab || !secondTab) throw new Error("複数タブのHitを識別できない");
    assertPageviewIdentity(ctx, firstTab, { path: "/" });
    assertPageviewIdentity(ctx, secondTab, { path: "/spa" });
    const shared = await snapshotTdCookies(ctx.page);
    if (!shared.vid || !shared.sid) {
      throw new Error("複数タブ初期化後に共有Cookieが発行されない");
    }

    // 初期化2操作はpageviewを正確に2件送る。初回Hit間のvid/sid一致は要求しない。
    // navigationのPromise.allはCookie readの真の同時実行を保証しないためである。
    // 競合後は共有Cookieへ収束し、次のvisitはpageviewを正確に1件送る。
    const converged = await visitAndGetPageview(ctx, "/products", sibling);
    if (converged.vid !== shared.vid || converged.sid !== shared.sid) {
      throw new Error("複数タブ初期化後に共有Cookieへ収束しない");
    }
  } finally {
    await sibling.close();
  }
}
