import type { Cookie } from "playwright";

import {
  clickSpaOrderComplete,
  getNoReloadMarker,
  gotoDemoPage,
  setNoReloadMarker,
  setTdSidCookie,
} from "../browser/index.js";
import { DEMO_SITE_ORIGIN, UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import type { BrowserName } from "../harness/config.js";
import { createE2eSession } from "../harness/session.js";
import type { E2eContext } from "../harness/types.js";
import {
  ANON_SID_RE,
  ANON_VID_RE,
  EVENT_ID_PURCHASE,
  expectAnonIdsPresent,
  expectEventCountExactlyIncreasedBy,
  expectPageviewCountAtLeast,
  expectHitPayload,
  quiesceBeacons,
  waitForNewHit,
} from "../tracking/index.js";

/** tracker.ts と同じ Max-Age(秒) */
const VID_MAX_AGE_SEC = 2 * 365 * 24 * 60 * 60;
const SID_MAX_AGE_SEC = 30 * 60;
/** 再延長検証用に意図的に短くする Max-Age(秒) */
const SHORT_MAX_AGE_SEC = 60;
/** Chromium 等の Cookie 寿命上限(約400日)。Max-Age=2年でも実効 expires はここに丸められる */
const BROWSER_COOKIE_CAP_SEC = 400 * 24 * 60 * 60;
/** Safari ITP 相当の Cookie 寿命上限(7日)。webkit のみ許容 */
const ITP_COOKIE_CAP_SEC = 7 * 24 * 60 * 60;
/** expires 比較の許容誤差(秒)。発行〜読取の遅延を吸収 */
const EXPIRES_TOLERANCE_SEC = 120;

/** デモ HTTP 向け Cookie 属性(Path=/; SameSite=Lax; Secure/HttpOnly なし)を検証する */
function assertDemoCookieAttrs(cookie: Cookie, name: string): void {
  if (cookie.path !== "/") {
    throw new Error(`${name} path が "/" ではない: ${cookie.path}`);
  }
  if (cookie.sameSite !== "Lax") {
    throw new Error(`${name} sameSite が Lax ではない: ${cookie.sameSite}`);
  }
  if (cookie.secure !== false) {
    throw new Error(
      `${name} secure が false ではない(デモ HTTP): ${cookie.secure}`
    );
  }
  if (cookie.httpOnly !== false) {
    throw new Error(
      `${name} httpOnly が false ではない(JS 読取が必要): ${cookie.httpOnly}`
    );
  }
}

/**
 * Playwright Cookie.expires(Unix 秒)が Max-Age 相当か検証する。
 * 許容キャップは browserName で分岐する:
 * - chromium / firefox: uncapped または Chromium 約400日(ITP 7日は許容しない)
 * - webkit: 上記に加え Safari ITP 相当 7日も許容
 */
function assertCookieExpires(
  cookie: Cookie,
  name: string,
  maxAgeSec: number,
  issuedAtSec: number,
  browserName: BrowserName
): void {
  const expectedUncapped = issuedAtSec + maxAgeSec;
  const expectedBrowserCapped =
    issuedAtSec + Math.min(maxAgeSec, BROWSER_COOKIE_CAP_SEC);
  const deltaUncapped = Math.abs(cookie.expires - expectedUncapped);
  const deltaBrowserCapped = Math.abs(cookie.expires - expectedBrowserCapped);
  const allowItp = browserName === "webkit";
  const expectedItpCapped =
    issuedAtSec + Math.min(maxAgeSec, ITP_COOKIE_CAP_SEC);
  const deltaItpCapped = Math.abs(cookie.expires - expectedItpCapped);
  const matched =
    deltaUncapped <= EXPIRES_TOLERANCE_SEC ||
    deltaBrowserCapped <= EXPIRES_TOLERANCE_SEC ||
    (allowItp && deltaItpCapped <= EXPIRES_TOLERANCE_SEC);
  if (!matched) {
    const allowedCaps = allowItp
      ? `ブラウザ上限${BROWSER_COOKIE_CAP_SEC}s / ITP相当${ITP_COOKIE_CAP_SEC}s`
      : `ブラウザ上限${BROWSER_COOKIE_CAP_SEC}s`;
    const expectedParts = allowItp
      ? `${expectedUncapped}|${expectedBrowserCapped}|${expectedItpCapped}`
      : `${expectedUncapped}|${expectedBrowserCapped}`;
    const deltaParts = allowItp
      ? `${deltaUncapped}|${deltaBrowserCapped}|${deltaItpCapped}s`
      : `${deltaUncapped}|${deltaBrowserCapped}s`;
    throw new Error(
      `${name} expires が Max-Age=${maxAgeSec}s(または${allowedCaps})相当でない[${browserName}]: expires=${cookie.expires} expected≈${expectedParts} delta=${deltaParts}`
    );
  }
}

/** シナリオ context の _td_vid / _td_sid 値をスナップショットする */
async function snapshotTdCookies(
  page: E2eContext["page"]
): Promise<{ vid: string | undefined; sid: string | undefined }> {
  const cookies = await page.context().cookies(DEMO_SITE_ORIGIN);
  return {
    sid: cookies.find((c) => c.name === "_td_sid")?.value,
    vid: cookies.find((c) => c.name === "_td_vid")?.value,
  };
}

/** first-party Cookie による匿名識別(vid=client_id / sid=session_id) */
export async function testCookieIdentity(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);

  // 他シナリオの Cookie を消して初回訪問相当にする
  await ctx.page.context().clearCookies();

  // (a) 初回 PV で Cookie 発行、ヒットに非空 vid/sid、属性を検証
  let hitCursor = await ctx.tracking.captureHitCursor();
  const issuedAtSec = Date.now() / 1000;
  await gotoDemoPage(ctx.page, "/");
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    1,
    "初回 pageview ビーコンを受信"
  );
  const firstHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "初回 pageview ヒット取得"
  );
  if (!ANON_VID_RE.test(firstHit.vid)) {
    throw new Error(`初回 hit.vid の形式が不正: ${firstHit.vid}`);
  }
  if (!ANON_SID_RE.test(firstHit.sid)) {
    throw new Error(`初回 hit.sid の形式が不正: ${firstHit.sid}`);
  }
  expectHitPayload(firstHit, {
    eventId: null,
    sid: firstHit.sid,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/",
    vid: firstHit.vid,
    workspaceId: WORKSPACE_ID,
  });
  const cookiesAfterFirst = await ctx.page.context().cookies(DEMO_SITE_ORIGIN);
  const vidCookie = cookiesAfterFirst.find((c) => c.name === "_td_vid");
  const sidCookie = cookiesAfterFirst.find((c) => c.name === "_td_sid");
  if (!vidCookie || vidCookie.value !== firstHit.vid) {
    throw new Error(
      `_td_vid Cookie がヒットと不一致: cookie=${vidCookie?.value} hit=${firstHit.vid}`
    );
  }
  if (!sidCookie || sidCookie.value !== firstHit.sid) {
    throw new Error(
      `_td_sid Cookie がヒットと不一致: cookie=${sidCookie?.value} hit=${firstHit.sid}`
    );
  }
  assertDemoCookieAttrs(vidCookie, "_td_vid");
  assertDemoCookieAttrs(sidCookie, "_td_sid");
  assertCookieExpires(
    vidCookie,
    "_td_vid",
    VID_MAX_AGE_SEC,
    issuedAtSec,
    ctx.browserName
  );
  assertCookieExpires(
    sidCookie,
    "_td_sid",
    SID_MAX_AGE_SEC,
    issuedAtSec,
    ctx.browserName
  );
  console.log("  ✓ 初回 PV で Cookie 発行・ヒットに非空 vid/sid・属性OK");

  const stableVid = firstHit.vid;
  const stableSid = firstHit.sid;

  // (b) MPA 遷移後も同一 vid・同一 sid(セッション継続)
  hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/products");
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    1,
    "MPA 遷移後の pageview を受信"
  );
  const mpaHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "MPA 遷移 pageview ヒット取得"
  );
  expectHitPayload(mpaHit, {
    eventId: null,
    sid: stableSid,
    type: "pageview",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/products",
    vid: stableVid,
    workspaceId: WORKSPACE_ID,
  });
  console.log("  ✓ MPA 遷移後も同一 vid・同一 sid");

  // (c) SPA pushState 遷移後も同一 vid・同一 sid(リロードなし)
  const purchaseCountBefore =
    await ctx.tracking.getEventCount7d(EVENT_ID_PURCHASE);
  hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/spa");
  await setNoReloadMarker(ctx.page);
  await clickSpaOrderComplete(ctx.page);
  await expectEventCountExactlyIncreasedBy(
    ctx.tracking,
    EVENT_ID_PURCHASE,
    purchaseCountBefore,
    1,
    "SPA 遷移で購入完了イベント +1"
  );
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    2,
    "SPA 遷移で pageview を受信(初回PV + 遷移PV)"
  );
  const spaMarker = await getNoReloadMarker(ctx.page);
  if (spaMarker !== 1) {
    throw new Error("SPA 遷移でページがリロードされている");
  }
  const spaHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: EVENT_ID_PURCHASE, type: "event" },
    "SPA 遷移 購入ヒット取得"
  );
  expectHitPayload(spaHit, {
    eventId: EVENT_ID_PURCHASE,
    sid: stableSid,
    type: "event",
    uaIncludes: UA_TOKEN[ctx.browserName],
    urlIncludes: "/order/complete",
    vid: stableVid,
    workspaceId: WORKSPACE_ID,
  });
  console.log("  ✓ SPA 遷移後も同一 vid・同一 sid(リロードなし)");

  // (d) _td_sid の Max-Age 再延長: 短い寿命に上書き → 次 PV で SID_MAX_AGE 相当へ戻る
  await ctx.page.evaluate(
    ({ sid, shortMaxAge }) => {
      document.cookie = `_td_sid=${encodeURIComponent(sid)}; Path=/; Max-Age=${shortMaxAge}; SameSite=Lax`;
    },
    { shortMaxAge: SHORT_MAX_AGE_SEC, sid: stableSid }
  );
  const cookiesAfterShorten = await ctx.page
    .context()
    .cookies(DEMO_SITE_ORIGIN);
  const sidShortened = cookiesAfterShorten.find((c) => c.name === "_td_sid");
  if (!sidShortened) {
    throw new Error("短い Max-Age 上書き後に _td_sid がない");
  }
  const shortenedAtSec = Date.now() / 1000;
  assertCookieExpires(
    sidShortened,
    "_td_sid(短縮後)",
    SHORT_MAX_AGE_SEC,
    shortenedAtSec,
    ctx.browserName
  );

  hitCursor = await ctx.tracking.captureHitCursor();
  const renewedAtSec = Date.now() / 1000;
  await gotoDemoPage(ctx.page, "/");
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    1,
    "Max-Age 再延長用の pageview を受信"
  );
  const renewHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "Max-Age 再延長用 pageview ヒット取得"
  );
  expectHitPayload(renewHit, {
    eventId: null,
    sid: stableSid,
    type: "pageview",
    vid: stableVid,
    workspaceId: WORKSPACE_ID,
  });
  const cookiesAfterRenew = await ctx.page.context().cookies(DEMO_SITE_ORIGIN);
  const sidRenewed = cookiesAfterRenew.find((c) => c.name === "_td_sid");
  if (!sidRenewed) {
    throw new Error("再延長後に _td_sid がない");
  }
  assertCookieExpires(
    sidRenewed,
    "_td_sid",
    SID_MAX_AGE_SEC,
    renewedAtSec,
    ctx.browserName
  );
  console.log("  ✓ 2ヒット目で _td_sid の Max-Age が約30分へ再延長");

  // (e) _td_vid も同様に短い寿命へ上書き → 次 PV で VID_MAX_AGE 相当へ戻る(値は同一)
  await ctx.page.evaluate(
    ({ shortMaxAge, vid }) => {
      document.cookie = `_td_vid=${encodeURIComponent(vid)}; Path=/; Max-Age=${shortMaxAge}; SameSite=Lax`;
    },
    { shortMaxAge: SHORT_MAX_AGE_SEC, vid: stableVid }
  );
  const cookiesAfterVidShorten = await ctx.page
    .context()
    .cookies(DEMO_SITE_ORIGIN);
  const vidShortened = cookiesAfterVidShorten.find((c) => c.name === "_td_vid");
  if (!vidShortened) {
    throw new Error("短い Max-Age 上書き後に _td_vid がない");
  }
  const vidShortenedAtSec = Date.now() / 1000;
  assertCookieExpires(
    vidShortened,
    "_td_vid(短縮後)",
    SHORT_MAX_AGE_SEC,
    vidShortenedAtSec,
    ctx.browserName
  );

  hitCursor = await ctx.tracking.captureHitCursor();
  const vidRenewedAtSec = Date.now() / 1000;
  await gotoDemoPage(ctx.page, "/products");
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    1,
    "vid Max-Age 再延長用の pageview を受信"
  );
  const vidRenewHit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "vid Max-Age 再延長用 pageview ヒット取得"
  );
  expectHitPayload(vidRenewHit, {
    eventId: null,
    sid: stableSid,
    type: "pageview",
    vid: stableVid,
    workspaceId: WORKSPACE_ID,
  });
  const cookiesAfterVidRenew = await ctx.page
    .context()
    .cookies(DEMO_SITE_ORIGIN);
  const vidRenewed = cookiesAfterVidRenew.find((c) => c.name === "_td_vid");
  if (!vidRenewed) {
    throw new Error("再延長後に _td_vid がない");
  }
  if (vidRenewed.value !== stableVid) {
    throw new Error(
      `vid Max-Age 再延長で値が変わった: got=${vidRenewed.value} want=${stableVid}`
    );
  }
  assertCookieExpires(
    vidRenewed,
    "_td_vid",
    VID_MAX_AGE_SEC,
    vidRenewedAtSec,
    ctx.browserName
  );
  console.log(
    "  ✓ 2ヒット目で _td_vid の Max-Age が約2年相当へ再延長(値は同一)"
  );

  // (f) _td_sid 削除 → 次ヒットは同一 vid・新しい sid(セッション区切り)
  await ctx.page.evaluate(() => {
    document.cookie = "_td_sid=; Path=/; Max-Age=0; SameSite=Lax";
  });
  hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/");
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    1,
    "sid 削除後の pageview を受信"
  );
  const afterSidClear = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "sid 削除後 pageview ヒット取得"
  );
  if (afterSidClear.vid !== stableVid) {
    throw new Error(
      `sid 削除後に vid が変わった: got=${afterSidClear.vid} want=${stableVid}`
    );
  }
  if (afterSidClear.sid === stableSid) {
    throw new Error(`sid 削除後も sid が同じ: ${afterSidClear.sid}`);
  }
  if (!ANON_SID_RE.test(afterSidClear.sid)) {
    throw new Error(`新 sid の形式が不正: ${afterSidClear.sid}`);
  }
  expectHitPayload(afterSidClear, {
    eventId: null,
    sid: afterSidClear.sid,
    type: "pageview",
    vid: stableVid,
    workspaceId: WORKSPACE_ID,
  });
  console.log("  ✓ _td_sid 削除後は同一 vid・新しい sid");

  const newSid = afterSidClear.sid;

  // (g) _td_vid も削除 → 新しい vid(client_id リセット)
  await ctx.page.evaluate(() => {
    document.cookie = "_td_vid=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "_td_sid=; Path=/; Max-Age=0; SameSite=Lax";
  });
  hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/products");
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    1,
    "vid 削除後の pageview を受信"
  );
  const afterVidClear = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "vid 削除後 pageview ヒット取得"
  );
  if (afterVidClear.vid === stableVid) {
    throw new Error(`vid 削除後も vid が同じ: ${afterVidClear.vid}`);
  }
  if (!ANON_VID_RE.test(afterVidClear.vid)) {
    throw new Error(`新 vid の形式が不正: ${afterVidClear.vid}`);
  }
  if (afterVidClear.sid === newSid || afterVidClear.sid === stableSid) {
    throw new Error(`vid 削除後も旧 sid が残った: ${afterVidClear.sid}`);
  }
  if (!ANON_SID_RE.test(afterVidClear.sid)) {
    throw new Error(`vid 削除後の新 sid の形式が不正: ${afterVidClear.sid}`);
  }
  expectHitPayload(afterVidClear, {
    eventId: null,
    sid: afterVidClear.sid,
    type: "pageview",
    vid: afterVidClear.vid,
    workspaceId: WORKSPACE_ID,
  });
  console.log("  ✓ _td_vid 削除後は新しい vid(client_id リセット)");

  // (g2) 形式不正 _td_sid → 次 PV で再発行(ANON_SID_RE に合い、不正値ではない)
  const INVALID_SID = "not-a-valid-sid";
  await setTdSidCookie(ctx.page, INVALID_SID);
  hitCursor = await ctx.tracking.captureHitCursor();
  await gotoDemoPage(ctx.page, "/");
  await expectPageviewCountAtLeast(
    ctx.tracking,
    hitCursor,
    1,
    "形式不正 sid 後の pageview を受信"
  );
  const afterInvalidSid = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: null, type: "pageview" },
    "形式不正 sid 後 pageview ヒット取得"
  );
  if (afterInvalidSid.vid !== afterVidClear.vid) {
    throw new Error(
      `形式不正 sid 後に vid が変わった: got=${afterInvalidSid.vid} want=${afterVidClear.vid}`
    );
  }
  if (afterInvalidSid.sid === INVALID_SID) {
    throw new Error(
      `形式不正 sid が再発行されず残った: ${afterInvalidSid.sid}`
    );
  }
  if (!ANON_SID_RE.test(afterInvalidSid.sid)) {
    throw new Error(
      `形式不正 sid 再発行後の sid 形式が不正: ${afterInvalidSid.sid}`
    );
  }
  expectHitPayload(afterInvalidSid, {
    eventId: null,
    sid: afterInvalidSid.sid,
    type: "pageview",
    vid: afterVidClear.vid,
    workspaceId: WORKSPACE_ID,
  });
  console.log("  ✓ 形式不正 _td_sid は次 PV で再発行される");

  // (h) Cookie 無効化相当: 独立 BrowserContext で document.cookie を読み書き不能にし、
  // ビーコンは届くが遷移をまたいだ再訪識別は成立しないことを確認する
  // (シナリオ ctx.page を汚染しない)
  const sharedCookiesBeforeH = await snapshotTdCookies(ctx.page);
  if (!sharedCookiesBeforeH.vid || !sharedCookiesBeforeH.sid) {
    throw new Error(
      `(h) 開始前にシナリオ context の _td_vid/_td_sid がない: vid=${sharedCookiesBeforeH.vid} sid=${sharedCookiesBeforeH.sid}`
    );
  }
  // (g2) 後の vid/sid が残っていること(独立 context 汚染検知の基準)
  if (sharedCookiesBeforeH.vid !== afterInvalidSid.vid) {
    throw new Error(
      `(h) 開始前のシナリオ _td_vid が (g2) 後と不一致: cookie=${sharedCookiesBeforeH.vid} hit=${afterInvalidSid.vid}`
    );
  }
  if (sharedCookiesBeforeH.sid !== afterInvalidSid.sid) {
    throw new Error(
      `(h) 開始前のシナリオ _td_sid が (g2) 後と不一致: cookie=${sharedCookiesBeforeH.sid} hit=${afterInvalidSid.sid}`
    );
  }

  const { page: disabledPage, context: disabledContext } =
    await createE2eSession(ctx.browser, {
      browserName: ctx.browserName,
      correlationId: ctx.correlationId,
      userAgent: ctx.userAgent,
    });
  try {
    await disabledContext.addInitScript(() => {
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get() {
          return "";
        },
        set() {
          /* Cookie 無効化相当: 書き込みを無視 */
        },
      });
    });
    await disabledContext.clearCookies();

    hitCursor = await ctx.tracking.captureHitCursor();
    await gotoDemoPage(disabledPage, "/");
    await expectPageviewCountAtLeast(
      ctx.tracking,
      hitCursor,
      1,
      "Cookie 無効相当の初回 pageview を受信"
    );
    const disabledHit1 = await waitForNewHit(
      ctx.tracking,
      { afterHitId: hitCursor, eventId: null, type: "pageview" },
      "Cookie 無効相当の初回ヒット取得"
    );
    expectAnonIdsPresent(disabledHit1);

    hitCursor = await ctx.tracking.captureHitCursor();
    await gotoDemoPage(disabledPage, "/products");
    await expectPageviewCountAtLeast(
      ctx.tracking,
      hitCursor,
      1,
      "Cookie 無効相当の2回目 pageview を受信"
    );
    const disabledHit2 = await waitForNewHit(
      ctx.tracking,
      { afterHitId: hitCursor, eventId: null, type: "pageview" },
      "Cookie 無効相当の2回目ヒット取得"
    );
    expectAnonIdsPresent(disabledHit2);
    if (disabledHit2.vid === disabledHit1.vid) {
      throw new Error(
        `Cookie 無効相当なのに vid が継続した: ${disabledHit2.vid}`
      );
    }
    if (disabledHit2.sid === disabledHit1.sid) {
      throw new Error(
        `Cookie 無効相当なのに sid が継続した: ${disabledHit2.sid}`
      );
    }
    console.log(
      "  ✓ Cookie 無効相当: ビーコンは届くが再訪識別・セッション継続は成立しない"
    );
  } finally {
    try {
      await disabledContext.close();
    } catch (error) {
      console.error(`  context.close failed: ${String(error)}`);
    }
  }

  // 独立 context の initScript / clearCookies がシナリオ page を汚染していないこと
  const sharedCookiesAfterH = await snapshotTdCookies(ctx.page);
  if (sharedCookiesAfterH.vid !== sharedCookiesBeforeH.vid) {
    throw new Error(
      `(h) 後にシナリオ _td_vid が変わった: before=${sharedCookiesBeforeH.vid} after=${sharedCookiesAfterH.vid}`
    );
  }
  if (sharedCookiesAfterH.sid !== sharedCookiesBeforeH.sid) {
    throw new Error(
      `(h) 後にシナリオ _td_sid が変わった: before=${sharedCookiesBeforeH.sid} after=${sharedCookiesAfterH.sid}`
    );
  }
  const sharedDocumentCookie = await ctx.page.evaluate(() => document.cookie);
  if (
    !sharedDocumentCookie.includes(`_td_vid=${sharedCookiesBeforeH.vid}`) ||
    !sharedDocumentCookie.includes(`_td_sid=${sharedCookiesBeforeH.sid}`)
  ) {
    throw new Error(
      `(h) 後にシナリオ page の document.cookie が読めない/値が消えた: ${sharedDocumentCookie}`
    );
  }
  console.log(
    "  ✓ Cookie 無効相当の独立 context がシナリオ page の Cookie を汚染していない"
  );
}
