import { gotoDemoPage, openSiblingTab } from "../browser/index.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectPageviewCountAtLeast,
  quiesceBeacons,
} from "../tracking/index.js";
import { snapshotTdCookies, visitAndGetPageview } from "./cookie-helpers.js";
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
    await expectPageviewCountAtLeast(
      ctx.tracking,
      cursor,
      2,
      "複数タブの同時pageview"
    );
    const hits = await ctx.tracking.getHitsMatching({
      afterHitId: cursor,
      eventId: null,
      type: "pageview",
    });
    const firstTab = hits.find((hit) => new URL(hit.url).pathname === "/");
    const secondTab = hits.find((hit) => hit.url.includes("/spa"));
    if (!firstTab || !secondTab) throw new Error("複数タブのHitを識別できない");
    const shared = await snapshotTdCookies(ctx.page);
    if (!shared.vid || !shared.sid) {
      throw new Error("複数タブ初期化後に共有Cookieが発行されない");
    }

    // navigation の Promise.all は Cookie read の真の同時実行を保証しない。
    // 初回Hit間の一致は要求せず、競合後に共有Cookieへ収束することを検証する。
    const converged = await visitAndGetPageview(ctx, "/products", sibling);
    if (converged.vid !== shared.vid || converged.sid !== shared.sid) {
      throw new Error("複数タブ初期化後に共有Cookieへ収束しない");
    }
  } finally {
    await sibling.close();
  }
}
