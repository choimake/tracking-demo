import { gotoDemoPage, spaPushState } from "../browser/index.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { E2eContext } from "../harness/types.js";
import {
  EVENT_ID_PURCHASE,
  quiesceBeacons,
  expectEventCountIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";

/**
 * URL正規化: normalizePath による大文字小文字・末尾スラッシュの吸収、
 * および日本語パス(パーセントエンコード⇄デコード)の一致を検証する
 */
export async function testUrlNormalize(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  await gotoDemoPage(ctx.page, "/spa");

  // --- 1) 大文字小文字 + 末尾スラッシュの正規化 ---
  // 既存 ev_purchase (url:/order/complete) に対し /Order/Complete/ へ SPA 遷移
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  const sinceMs = Date.now();
  await spaPushState(ctx.page, "/Order/Complete/");
  await expectEventCountIncreasedBy(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    purchaseCountBefore,
    1,
    "大文字小文字+末尾スラッシュの差分があっても購入完了イベント+1(正規化で一致)"
  );
  const caseHit = await waitForNewHit(
    ctx.tracking,
    { eventId: EVENT_ID_PURCHASE, sinceMs, type: "event" },
    "URL正規化(大文字小文字/末尾スラッシュ)ヒット取得"
  );
  expectHitPayload(caseHit, {
    eventId: EVENT_ID_PURCHASE,
    sinceMs,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: "/Order/Complete/",
    workspaceId: WORKSPACE_ID,
  });
  console.log(
    "  ✓ /Order/Complete/ (大文字+末尾スラッシュ) でも url:/order/complete が発火することを確認"
  );

  // --- 2) 日本語パス(パーセントエンコード⇄デコード) ---
  const { japaneseUrlEventId } = ctx.fixtures;
  const jpEncodedPath = encodeURI("/注文/完了");
  const jpCountBefore = await ctx.tracking.getEventCount7d(japaneseUrlEventId);
  const jpSinceMs = Date.now();
  await spaPushState(ctx.page, jpEncodedPath);
  await expectEventCountIncreasedBy(
    ctx.tracking,
    japaneseUrlEventId,
    jpCountBefore,
    1,
    "日本語パス(パーセントエンコード)への遷移でも url:/注文/完了 が+1"
  );
  const jpHit = await waitForNewHit(
    ctx.tracking,
    { eventId: japaneseUrlEventId, sinceMs: jpSinceMs, type: "event" },
    "日本語パスヒット取得"
  );
  expectHitPayload(jpHit, {
    eventId: japaneseUrlEventId,
    sinceMs: jpSinceMs,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    untilMs: Date.now(),
    urlIncludes: jpEncodedPath,
    workspaceId: WORKSPACE_ID,
  });
  console.log(
    "  ✓ パーセントエンコードされた日本語パスでもデコード後の一致で発火することを確認"
  );
}
