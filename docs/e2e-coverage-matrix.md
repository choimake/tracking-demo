# E2E Coverage Matrix

> 初期版。Phase 完了ごとに更新する。Phase 3・4 の残タスク 07・08・09・11・13 を反映した後に最終版を確定する。

## 目的と使い方

この Matrix は、計測 contract の保証先と未保証範囲を示す。新規機能の PR では、次の順に更新要否を判断する。

1. 既存 contract の入力、出力、失敗時の挙動を変える場合は、該当行を更新する。
2. 新しい contract を追加する場合は、positive と negative を追加する。境界値または障害経路がある場合は、その種別も追加する。
3. ブラウザの API、Cookie、History、ライフサイクルへ依存する場合は、browser E2E の要否を判断する。
4. ブラウザを必要としない入力境界は unit または integration が担当する。
5. 対応しない機能は「スコープ外」とする。対応予定だがテストがない機能は「未実装」とする。

## 判定軸

### 担当層

| 担当層      | リポジトリ内の実体                                                                                                                       | 担当範囲                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| unit        | 専用テスト基盤なし                                                                                                                       | URL・trigger・config の純粋な解析と境界値。必要なケースは未実装として管理する |
| integration | `scripts/e2e/harness/*.regression-check.ts`、`scripts/e2e/observation.regression-check.ts`、`scripts/e2e/tracking/*.regression-check.ts` | ブラウザ不要の fixture、observation、相関、assertion の contract              |
| browser E2E | `scripts/e2e/`                                                                                                                           | tracker.js を読み込むページ操作から `/api/collect` の Hit までの contract     |
| mutation    | `scripts/mutation/` と `scripts/e2e/bench/`                                                                                              | Chromium E2E oracle の検出力。凍結した mutant に限定する                      |

unit の専用テスト基盤は現在存在しない。browser E2E で扱わない入力境界を追加するときは、unit の導入または integration の回帰チェック追加を PR で判断する。

### ブラウザと実行頻度

| 表記      | 意味                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C / F / W | Playwright の chromium / firefox / webkit project。`npm run e2e` が3 projectを直列実行する                                              |
| M         | `E2E_MOBILE=1` の mobile emulation。全20シナリオをローカルで実行する。Firefox は `isMobile` を使わず、`hasTouch` と viewport で代替する |
| PR        | PR 統合前にローカルで実行する品質ゲート。E2E と quality を実行する GitHub Actions は現在ない                                            |
| nightly   | 現在は設定なし                                                                                                                          |
| manual    | ローカル専用の mobile、mutation、障害調査                                                                                               |

デスクトップの browser E2E は C / F / W を PR 統合前に実行する。M は manual とする。mutation は Chromium のみを manual で実行する。

## 登録済みシナリオ Matrix

次の20行は、`scripts/e2e/scenarios.ts` の登録順と一致する。owner は `tracker / E2E` とする。関連仕様は [`spec.md`](../spec.md) と [`scripts/e2e/README.md`](../scripts/e2e/README.md) である。

|   # | Contract                                          | 種別                           | 担当層      | 対応シナリオ                   | ブラウザ      | 実行頻度      | 既知の非対応・備考                                                                                              |
| --: | ------------------------------------------------- | ------------------------------ | ----------- | ------------------------------ | ------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
|   1 | tag load / collect / dataLayer                    | positive                       | browser E2E | `tests/tag-load.ts`            | C / F / W / M | PR、Mはmanual | dataLayer方式、非同期、クロスオリジンの初回pageviewを1件保証する                                                |
|   2 | URL到達 / collect                                 | positive                       | browser E2E | `tests/url-reach.ts`           | C / F / W / M | PR、Mはmanual | MPA遷移のURL到達を1件保証する                                                                                   |
|   3 | click / collect                                   | positive                       | browser E2E | `tests/click-trigger.ts`       | C / F / W / M | PR、Mはmanual | CSSセレクタに一致するクリックを1件保証する                                                                      |
|   4 | scroll / collect                                  | positive / boundary            | browser E2E | `tests/scroll-trigger.ts`      | C / F / W / M | PR、Mはmanual | 50%到達の境界を1件保証する。50%未満の単独境界は未実装                                                           |
|   5 | time-on-page / collect                            | positive / boundary            | browser E2E | `tests/time-on-page.ts`        | C / F / W / M | PR、Mはmanual | 2秒到達の境界を1件保証する                                                                                      |
|   6 | exit-intent / collect                             | positive / negative / boundary | browser E2E | `tests/exit-intent.ts`         | C / F / W / M | PR、Mはmanual | 非離脱操作は0件、デスクトップの離脱操作は1件を保証する                                                          |
|   7 | SPA・History / URL到達 / collect                  | positive / negative            | browser E2E | `tests/spa-history.ts`         | C / F / W / M | PR、Mはmanual | pushState遷移を保証する。同一パスのreplaceStateは追加pageview 0件。URL変更を伴うreplaceState単体は未実装        |
|   8 | dedup / SPA・History / dataLayer                  | negative / boundary            | browser E2E | `tests/gtm-dedup.ts`           | C / F / W / M | PR、Mはmanual | 自動検知と手動pushを重複排除する。1000msを超える意図的な再送は許容する                                          |
|   9 | dataLayer / collect                               | positive                       | browser E2E | `tests/datalayer-manual.ts`    | C / F / W / M | PR、Mはmanual | 手動pageviewを1件保証する                                                                                       |
|  10 | dataLayer / dedup / collect                       | positive / negative            | browser E2E | `tests/datalayer-queue.ts`     | C / F / W / M | PR、Mはmanual | ロード前キューを再生する。pageviewの二重計上を防ぐ                                                              |
|  11 | tag load / dedup                                  | negative                       | browser E2E | `tests/double-tag-guard.ts`    | C / F / W / M | PR、Mはmanual | 2つ目のタグ読み込みを無視する                                                                                   |
|  12 | config / collect                                  | negative                       | browser E2E | `tests/disabled-event.ts`      | C / F / W / M | PR、Mはmanual | 無効イベントを配信から除外する。受信側でも破棄し、0件表示を保証する                                             |
|  13 | SPA・History / URL到達 / collect                  | positive / negative            | browser E2E | `tests/spa-popstate.ts`        | C / F / W / M | PR、Mはmanual | popstateで戻り先pageviewを再送する。戻る操作だけでは購入イベントを増やさない                                    |
|  14 | time-on-page / SPA・History                       | negative / boundary            | browser E2E | `tests/time-on-page-cancel.ts` | C / F / W / M | PR、Mはmanual | 閾値未満の滞在を繰り返しても発火しない                                                                          |
|  15 | click / scroll / fire semantics                   | positive / negative / boundary | browser E2E | `tests/fire-semantics.ts`      | C / F / W / M | PR、Mはmanual | clickは複数回発火する。scrollは1 pageviewにつき2回目を発火しない                                                |
|  16 | URL到達 / SPA・History                            | positive / boundary            | browser E2E | `tests/url-normalize.ts`       | C / F / W / M | PR、Mはmanual | 大文字小文字、末尾スラッシュ、日本語パスの一致を保証する                                                        |
|  17 | exit-intent                                       | negative / boundary            | browser E2E | `tests/exit-intent-mobile.ts`  | C / F / W / M | PR、Mはmanual | mobile emulationのタップだけでは発火しない。実機での発火はスコープ外                                            |
|  18 | SPA・History                                      | negative                       | browser E2E | `tests/hash-navigation.ts`     | C / F / W / M | PR、Mはmanual | 非対応contractを固定済み。hash変更では新しいpageviewを発火しない                                                |
|  19 | SPA・History                                      | negative                       | browser E2E | `tests/query-only.ts`          | C / F / W / M | PR、Mはmanual | 非対応contractを固定済み。query-only遷移ではpageviewを再評価しない                                              |
|  20 | Cookie / cookie identity / SPA・History / collect | positive / negative / boundary | browser E2E | `tests/cookie-identity.ts`     | C / F / W / M | PR、Mはmanual | vid/sidの発行、MPA/SPA継続、再延長、区切り、リセット、Cookie無効相当を保証する。複数タブとHTTPS属性は保証しない |

## 重要 contract の両方向保証

| 重要 contract            | positive                                                   | negative                                                        | 判定                             |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| tag load                 | `tag-load.ts`                                              | `double-tag-guard.ts`                                           | 両方あり                         |
| config                   | `click-trigger.ts`、`scroll-trigger.ts`、`time-on-page.ts` | `disabled-event.ts`                                             | 両方あり。ただし取得障害は未実装 |
| collect                  | 発火系シナリオのHit着弾                                    | `disabled-event.ts`の受信破棄                                   | 両方あり。ただし通信障害は未実装 |
| dedup                    | `gtm-dedup.ts`の1000ms超再送                               | `gtm-dedup.ts`、`datalayer-queue.ts`、`double-tag-guard.ts`     | 両方あり                         |
| Cookie / cookie identity | `cookie-identity.ts`の発行・継続・再延長                   | 同ファイルのリセット・Cookie無効相当                            | 両方あり                         |
| SPA・History             | `spa-history.ts`、`spa-popstate.ts`                        | `hash-navigation.ts`、`query-only.ts`、`time-on-page-cancel.ts` | 両方あり                         |
| dataLayer                | `datalayer-manual.ts`、`datalayer-queue.ts`                | `gtm-dedup.ts`、`datalayer-queue.ts`                            | 両方あり                         |

## browser E2E 以外の担当

| Contract / 境界                      | 種別                           | 担当層                    | 対応                                                                       | ブラウザ                             | 実行頻度                | owner / 関連仕様                                                     |
| ------------------------------------ | ------------------------------ | ------------------------- | -------------------------------------------------------------------------- | ------------------------------------ | ----------------------- | -------------------------------------------------------------------- |
| fixtureの所有権・回収・rollback      | failure / boundary             | integration               | `harness/fixture.regression-check.ts`                                      | 不要                                 | PR（`npm run quality`） | E2E基盤 / `scripts/e2e/README.md`                                    |
| observation                          | failure / boundary             | integration               | `observation.regression-check.ts`                                          | 不要                                 | PR（`npm run quality`） | E2E基盤 / `scripts/e2e/README.md`                                    |
| run専用stack・session                | failure / boundary             | integration               | `harness/stack.regression-check.ts`、`harness/session.regression-check.ts` | 不要                                 | manual                  | E2E基盤 / `scripts/e2e/README.md`                                    |
| Hit相関・assertion                   | positive / negative / boundary | integration               | `tracking/*.regression-check.ts`                                           | 不要                                 | PR（`npm run quality`） | E2E基盤 / `scripts/e2e/README.md`                                    |
| E2E oracleの検出力                   | failure / boundary             | mutation                  | `scripts/mutation/`、`scripts/e2e/bench/`                                  | Chromiumのみ                         | manual                  | E2E基盤 / [`mutation-testing.md`](mutation-testing.md)               |
| URL・trigger・configの純粋な入力境界 | negative / boundary            | unit                      | 未実装                                                                     | 不要                                 | 未設定                  | tracker / `spec.md`。不正値、最小値、最大値をbrowser E2Eへ追加しない |
| config・tracker・collectのHTTP障害   | failure                        | integration + browser E2E | 未実装（タスク08）                                                         | Cを必須。F / Wは差異がある場合に追加 | PR                      | tracker / E2E                                                        |
| BFCache・offline・page close         | failure / boundary             | integration + browser E2E | 未実装（タスク08・09）                                                     | Cを必須。エンジン差はmanualで確認    | PR / manual             | tracker / E2E。offlineの担当はPhase統合時に08または09へ確定する      |

## gap の3分類

### 対応済み

| gap             | 担当層      | 根拠                                                                          |
| --------------- | ----------- | ----------------------------------------------------------------------------- |
| query-only遷移  | browser E2E | `tests/query-only.ts` が新しいpageviewを発火しない負のcontractを固定する      |
| hash navigation | browser E2E | `tests/hash-navigation.ts` が新しいpageviewを発火しない負のcontractを固定する |

「対応済み」は非対応contractのテストが存在することを示す。tracker.js が機能を提供することは示さない。

### 未実装

| gap                              | 担当層                    | 担当タスク                  | 完了条件                                                                      |
| -------------------------------- | ------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| sendBeacon失敗時のfetch fallback | browser E2E               | 08                          | sendBeaconがfalseを返す経路でfetchのHitを検証する                             |
| config取得障害                   | integration + browser E2E | 08                          | HTTPエラー、応答不正、タイムアウト時のcontractを固定する                      |
| tracker.js取得障害               | browser E2E               | 08                          | 読み込み失敗時に誤Hitと未処理例外がないことを固定する                         |
| collect障害                      | integration + browser E2E | 08                          | HTTPエラーと通信断時の送信contractを固定する                                  |
| replaceState単体                 | browser E2E               | 09                          | URL変更を伴うreplaceStateのpageview再評価を検証する。同一パスの不発は対応済み |
| BFCache                          | browser E2E               | 09                          | 復元時のpageviewとtriggerの重複可否を決めて固定する                           |
| offline                          | integration + browser E2E | 08・09（Phase統合時に確定） | offline中と復帰後の送信contractを決めて固定する                               |
| page close                       | browser E2E               | 09                          | close直前の送信保証範囲を決めて固定する                                       |
| Cookie複数タブ                   | browser E2E               | Phase 3・4残タスクで割当    | 同一BrowserContextの複数pageでvid/sidの継続と競合を検証する                   |

### スコープ外

| gap                              | 理由                                                                                                           | 再判断条件                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| CSP環境                          | デモはCSPヘッダーを提供しない                                                                                  | 本番のscript-src、connect-src、nonce方針が決まった時点 |
| CookieのHTTPS属性                | デモはHTTPであり、Secureを付与しない                                                                           | HTTPSのfixtureを導入する時点                           |
| consent / DNT / GPC              | CMPと同意管理を製品範囲に含めない                                                                              | 製品要件へ追加する時点                                 |
| モバイル実機の離脱インテント発火 | 離脱インテントはデスクトップのmouseoutを前提とする                                                             | トリガー仕様を変更する時点                             |
| 実Safari・実機                   | PlaywrightのWebKitとmobile emulationは実Safari・実機を完全には再現しない。リポジトリ内だけでは完全保証できない | 外部device farmまたは実機検証の運用を導入する時点      |
| 管理画面E2E                      | 初期版は計測trackerのcontractに限定する                                                                        | Phase統合後に管理画面をMatrixへ含めるか決定する時点    |

## 最終版への更新条件

Phase 3・4 の残タスク 07・08・09・11・13 が完了するたびに、scenario、gap、ブラウザ、実行頻度を更新する。Phase統合後に管理画面E2E、nightly、実機検証の採否を決定する。
