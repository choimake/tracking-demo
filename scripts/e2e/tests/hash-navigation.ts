import { changeLocationHash, gotoDemoPage } from "../browser/index.js";
import { BEACON_SETTLE_MS } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectNoHitsDuringObservation,
  quiesceBeacons,
} from "../tracking/index.js";

/** 非対応contract: hash だけの遷移では新しい pageview を発火しない。 */
export async function testHashNavigationUnsupported(
  ctx: E2eContext
): Promise<void> {
  await gotoDemoPage(ctx.page, "/spa#/a");
  await quiesceBeacons(ctx.tracking);
  const hitCursor = await ctx.tracking.captureHitCursor();

  await changeLocationHash(ctx.page, "#/b");

  await expectNoHitsDuringObservation(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "hash navigation の追加 pageview",
    { observationMs: BEACON_SETTLE_MS }
  );
}
