import { changeQueryOnly, gotoDemoPage } from "../browser/index.js";
import { BEACON_SETTLE_MS } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  expectNoHitsDuringObservation,
  quiesceBeacons,
} from "../tracking/index.js";

/** 非対応contract: query だけの遷移では pageview を再評価しない。 */
export async function testQueryOnlyUnsupported(ctx: E2eContext): Promise<void> {
  await gotoDemoPage(ctx.page, "/spa?color=red");
  await quiesceBeacons(ctx.tracking);
  const hitCursor = await ctx.tracking.captureHitCursor();

  await changeQueryOnly(ctx.page, "?color=blue");

  await expectNoHitsDuringObservation(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "query-only 遷移の追加 pageview",
    { observationMs: BEACON_SETTLE_MS }
  );
}
