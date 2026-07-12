import type { E2eContext } from "./harness/types.js";
import { testClickTrigger } from "./tests/click-trigger.js";
import { testCollectHttp500 } from "./tests/collect-http-500.js";
import { testCollectSendBeaconFallback } from "./tests/collect-sendbeacon-fallback.js";
import { testConfigHttp500 } from "./tests/config-http-500.js";
import { testCookieClientReset } from "./tests/cookie-client-reset.js";
import { testCookieInvalidValues } from "./tests/cookie-invalid-values.js";
import { testCookieIssuance } from "./tests/cookie-issuance.js";
import { testCookieMultitab } from "./tests/cookie-multitab.js";
import { testCookieNavigationContinuity } from "./tests/cookie-navigation-continuity.js";
import { testCookieRollingExpiration } from "./tests/cookie-rolling-expiration.js";
import { testCookieSessionReset } from "./tests/cookie-session-reset.js";
import { testCookieUnavailable } from "./tests/cookie-unavailable.js";
import { testDataLayerManualPageview } from "./tests/datalayer-manual.js";
import { testDataLayerQueueReplay } from "./tests/datalayer-queue.js";
import { testDisabledEventStopsTracking } from "./tests/disabled-event.js";
import { testDuplicateTagGuard } from "./tests/double-tag-guard.js";
import { testExitIntentMobile } from "./tests/exit-intent-mobile.js";
import { testExitIntentTrigger } from "./tests/exit-intent.js";
import { testFireSemantics } from "./tests/fire-semantics.js";
import { testGtmHistoryChangeDedup } from "./tests/gtm-dedup.js";
import { testHashNavigationUnsupported } from "./tests/hash-navigation.js";
import { testHistoryTraversal } from "./tests/history-traversal.js";
import { testPageLeaveTimerCancel } from "./tests/page-leave-timer.js";
import { testQueryOnlyUnsupported } from "./tests/query-only.js";
import { testReloadPageview } from "./tests/reload-pageview.js";
import { testReplaceStatePathChange } from "./tests/replace-state.js";
import { testScrollTrigger } from "./tests/scroll-trigger.js";
import { testSpaHistoryChange } from "./tests/spa-history.js";
import { testSpaPopstate } from "./tests/spa-popstate.js";
import { testTagLoadAndPageview } from "./tests/tag-load.js";
import { testTimeOnPageCancel } from "./tests/time-on-page-cancel.js";
import { testTimeOnPageTrigger } from "./tests/time-on-page.js";
import { testTrackerScriptHttp404 } from "./tests/tracker-script-http-404.js";
import { testUrlNormalize } from "./tests/url-normalize.js";
import { testUrlReachTrigger } from "./tests/url-reach.js";

export interface E2eScenario {
  id: string;
  name: string;
  run: (ctx: E2eContext) => Promise<void>;
  tags?: readonly string[];
}

/** 実行する全シナリオの登録一覧。新規テスト追加時はここに1行足す */
const registeredScenarios: Omit<E2eScenario, "id">[] = [
  {
    name: "タグ読み込み + ページビュー送信(dataLayer方式・非同期・クロスオリジン)",
    run: testTagLoadAndPageview,
  },
  { name: "URL到達トリガー(MPA遷移)", run: testUrlReachTrigger },
  { name: "クリックトリガー(CSSセレクタ)", run: testClickTrigger },
  { name: "スクロール率トリガー(50%)", run: testScrollTrigger },
  { name: "ページ滞在時間トリガー(2秒)", run: testTimeOnPageTrigger },
  { name: "離脱インテントトリガー", run: testExitIntentTrigger },
  {
    name: "SPA対応: History Change でページビュー再評価 + URL到達発火",
    run: testSpaHistoryChange,
  },
  {
    name: "GTM History Change併用(自動検知+手動push): 二重計上なし・1000ms超の再送は許容",
    run: testGtmHistoryChangeDedup,
  },
  {
    name: 'dataLayer 連携: tdDataLayer.push({event:"tracker.pageview"})',
    run: testDataLayerManualPageview,
  },
  {
    name: "dataLayer キュー再生: ロード前の push を処理し、かつ二重計上しない",
    run: testDataLayerQueueReplay,
  },
  {
    name: "タグ二重設置ガード: 2つ目の読み込みは無視される",
    run: testDuplicateTagGuard,
  },
  {
    name: "無効イベントは計測停止(配信除外・受信破棄・0件表示)",
    run: testDisabledEventStopsTracking,
  },
  {
    name: "SPA popstate(戻る): リロードなし・戻り先pageview再送・購入イベントは戻るだけでは増えない",
    run: testSpaPopstate,
  },
  {
    name: "滞在タイマー破棄: 閾値未満の滞在を繰り返すtime_on_pageイベントは発火しない",
    run: testTimeOnPageCancel,
  },
  {
    name: "発火回数の意味論: クリックは複数回発火(fire)・スクロール率は1PVにつき1回のみ(fireOnce)",
    run: testFireSemantics,
  },
  {
    name: "URL正規化: 大文字小文字・末尾スラッシュ・日本語パス(パーセントエンコード)の一致",
    run: testUrlNormalize,
  },
  {
    name: "モバイル(isMobile/hasTouch)ではタップ操作のみで離脱インテントが発火しない",
    run: testExitIntentMobile,
  },
  {
    name: "非対応contract: hash navigationでは新しいpageviewを発火しない",
    run: testHashNavigationUnsupported,
  },
  {
    name: "非対応contract: query-only遷移ではpageviewを再評価しない",
    run: testQueryOnlyUnsupported,
  },
  {
    name: "Cookie発行: 初回発行・形式・Hit一致・属性",
    run: testCookieIssuance,
    tags: ["cookie"],
  },
  {
    name: "Cookie継続: MPA/SPA遷移でvid/sidを維持",
    run: testCookieNavigationContinuity,
    tags: ["cookie"],
  },
  {
    name: "Cookie期限: sid/vidのMax-AgeをHitごとに再延長",
    run: testCookieRollingExpiration,
    tags: ["cookie"],
  },
  {
    name: "Cookieセッションリセット: sid削除後にsidを再発行",
    run: testCookieSessionReset,
    tags: ["cookie"],
  },
  {
    name: "Cookieクライアントリセット: vid/sid削除後に両方を再発行",
    run: testCookieClientReset,
    tags: ["cookie"],
  },
  {
    name: "Cookie不正値: malformed vid/sidから回復",
    run: testCookieInvalidValues,
    tags: ["cookie"],
  },
  {
    name: "Cookie利用不可: Hit送信とcontext非汚染",
    run: testCookieUnavailable,
    tags: ["cookie"],
  },
  {
    name: "Cookie複数タブ: 初期化競合後に共有vid/sidへ収束",
    run: testCookieMultitab,
    tags: ["cookie"],
  },
  {
    name: "replaceStateパス変更: リロードなしでpageviewを正確に1件送信",
    run: testReplaceStatePathChange,
  },
  {
    name: "reload: 再読み込み後のpageviewを正確に1件送信",
    run: testReloadPageview,
  },
  {
    name: "back/forward反復: 4操作の各移動先でpageviewを正確に1件送信",
    run: testHistoryTraversal,
  },
  {
    name: "ページ離脱: 旧ページのtime-on-page timerはイベントを送信しない",
    run: testPageLeaveTimerCancel,
  },
  {
    name: "Config障害: HTTP 500で初期化停止・dataLayer queue保持・retryなし",
    run: testConfigHttp500,
  },
  {
    name: "Collect障害: sendBeacon=falseでfetch fallbackを1回だけ実行",
    run: testCollectSendBeaconFallback,
  },
  {
    name: "Collect障害: fallback fetchのHTTP 500でretry・unhandled rejectionなし",
    run: testCollectHttp500,
  },
  {
    name: "Tracker script障害: HTTP 404で初期化・API要求・Hitなし",
    run: testTrackerScriptHttp404,
  },
];

/** IDは登録順から生成する。既存項目の順序変更ではなく末尾追加を原則とする。 */
export const e2eScenarios: E2eScenario[] = registeredScenarios.map(
  (scenario, index) => ({ ...scenario, id: `scenario-${index + 1}` })
);
