# E2E Coverage Matrix

> 最終版。2026-07-13時点の`scenarios.ts`、CI、回帰チェック、mutationカタログと同期する。

## 目的と更新規則

このMatrixは、計測contractの保証先と未保証範囲を示す。新規機能のPRでは次を確認する。

1. contractの入力、出力、失敗時の挙動を変える場合は該当行を更新する。
2. シナリオを追加した場合は、stable ID、名称、種別、担当層、実行対象を追加する。
3. 新しい重要contractにはpositiveとnegativeを用意する。境界値または障害経路がある場合は、その種別も追加する。
4. ブラウザAPI、Cookie、History、ライフサイクルへ依存するcontractはbrowser E2Eが担当する。
5. ブラウザを必要としない入力境界はunitまたはintegrationが担当する。
6. 製品範囲に含めない機能は「スコープ外」とする。製品範囲だが保証がない機能は「未実装」とする。

## 判定軸

| 担当層      | リポジトリ内の実体                                | 担当範囲                                                                       |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| unit        | 専用テスト基盤なし                                | URL、trigger、configの純粋な解析と入力境界。必要なケースは未実装として管理する |
| integration | `scripts/e2e/**/*.regression-check.ts`            | fixture、observation、相関、assertion、helper、scenario選択のcontract          |
| browser E2E | `scripts/e2e/tests/`                              | tracker.jsの読み込みとページ操作から`/api/collect`までのcontract               |
| mutation    | `scripts/mutation/`、`docs/mutation-catalog.json` | Chromium E2E oracleの検出力。キュレーションしたmutantを対象とする              |

| 表記      | 意味                                                                 |
| --------- | -------------------------------------------------------------------- |
| C / F / W | Playwrightのchromium / firefox / webkit。`npm run e2e`とCIが実行する |
| M         | `E2E_MOBILE=1`のmobile emulation。ローカルで手動実行する             |
| PR / CI   | PR統合前のローカル実行とpush / pull_requestのGitHub Actions          |
| manual    | mobile、動画、flake反復、mutation、障害調査                          |

nightlyは設定していない。mutationはChromiumだけを手動実行する。

## 登録済みシナリオ

次の35行は`scenarios.ts`の登録順と一致する。stable IDは既存行の順序を維持し、新規行を末尾へ追加することで固定する。ownerは`tracker / E2E`とする。関連仕様は[`spec.md`](../spec.md)と[`scripts/e2e/README.md`](../scripts/e2e/README.md)である。

| ID            | シナリオ名称                                                                             | Contract                         | 種別                           | 担当層      | ブラウザ | 頻度・備考                                  |
| ------------- | ---------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------ | ----------- | -------- | ------------------------------------------- |
| `scenario-1`  | タグ読み込み + ページビュー送信(dataLayer方式・非同期・クロスオリジン)                   | tag load / collect / dataLayer   | positive                       | browser E2E | C/F/W/M  | PR・CI、Mはmanual                           |
| `scenario-2`  | URL到達トリガー(MPA遷移)                                                                 | URL到達 / collect                | positive                       | browser E2E | C/F/W/M  | PR・CI、Mはmanual                           |
| `scenario-3`  | クリックトリガー(CSSセレクタ)                                                            | click / collect                  | positive                       | browser E2E | C/F/W/M  | PR・CI、Mはmanual                           |
| `scenario-4`  | スクロール率トリガー(50%)                                                                | scroll / collect                 | positive / boundary            | browser E2E | C/F/W/M  | 50%到達。PR・CI                             |
| `scenario-5`  | ページ滞在時間トリガー(2秒)                                                              | time-on-page / collect           | positive / boundary            | browser E2E | C/F/W/M  | 2秒到達。PR・CI                             |
| `scenario-6`  | 離脱インテントトリガー                                                                   | exit-intent / collect            | positive / negative / boundary | browser E2E | C/F/W/M  | 非離脱0件と離脱1件。PR・CI                  |
| `scenario-7`  | SPA対応: History Change でページビュー再評価 + URL到達発火                               | SPA・History / URL到達 / collect | positive / negative            | browser E2E | C/F/W/M  | pushStateと同一パスreplaceState 0件。PR・CI |
| `scenario-8`  | GTM History Change併用(自動検知+手動push): 二重計上なし・1000ms超の再送は許容            | dedup / SPA・History / dataLayer | positive / negative / boundary | browser E2E | C/F/W/M  | dedup境界。PR・CI                           |
| `scenario-9`  | dataLayer 連携: tdDataLayer.push({event:"tracker.pageview"})                             | dataLayer / collect              | positive                       | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-10` | dataLayer キュー再生: ロード前の push を処理し、かつ二重計上しない                       | dataLayer / dedup / collect      | positive / negative            | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-11` | タグ二重設置ガード: 2つ目の読み込みは無視される                                          | tag load / dedup                 | negative                       | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-12` | 無効イベントは計測停止(配信除外・受信破棄・0件表示)                                      | config / collect                 | negative                       | browser E2E | C/F/W/M  | 配信側と受信側の二重ガード。PR・CI          |
| `scenario-13` | SPA popstate(戻る): リロードなし・戻り先pageview再送・購入イベントは戻るだけでは増えない | SPA・History / collect           | positive / negative            | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-14` | 滞在タイマー破棄: 閾値未満の滞在を繰り返すtime_on_pageイベントは発火しない               | time-on-page / SPA・History      | negative / boundary            | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-15` | 発火回数の意味論: クリックは複数回発火(fire)・スクロール率は1PVにつき1回のみ(fireOnce)   | click / scroll / fire semantics  | positive / negative / boundary | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-16` | URL正規化: 大文字小文字・末尾スラッシュ・日本語パス(パーセントエンコード)の一致          | URL到達 / SPA・History           | positive / boundary            | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-17` | モバイル(isMobile/hasTouch)ではタップ操作のみで離脱インテントが発火しない                | exit-intent                      | negative / boundary            | browser E2E | C/F/W/M  | 実機はスコープ外。PR・CI                    |
| `scenario-18` | 非対応contract: hash navigationでは新しいpageviewを発火しない                            | SPA・History                     | negative                       | browser E2E | C/F/W/M  | 非対応を固定。PR・CI                        |
| `scenario-19` | 非対応contract: query-only遷移ではpageviewを再評価しない                                 | SPA・History                     | negative                       | browser E2E | C/F/W/M  | 非対応を固定。PR・CI                        |
| `scenario-20` | Cookie発行: 初回発行・形式・Hit一致・属性                                                | Cookie / collect                 | positive / boundary            | browser E2E | C/F/W/M  | HTTPのPath、SameSite、Secure=false。PR・CI  |
| `scenario-21` | Cookie継続: MPA/SPA遷移でvid/sidを維持                                                   | Cookie / SPA・History            | positive                       | browser E2E | C/F/W/M  | cookieタグ。PR・CI                          |
| `scenario-22` | Cookie期限: sid/vidのMax-AgeをHitごとに再延長                                            | Cookie                           | positive / boundary            | browser E2E | C/F/W/M  | cookieタグ。PR・CI                          |
| `scenario-23` | Cookieセッションリセット: sid削除後にsidを再発行                                         | Cookie                           | positive / negative            | browser E2E | C/F/W/M  | vid維持、sid再発行。PR・CI                  |
| `scenario-24` | Cookieクライアントリセット: vid/sid削除後に両方を再発行                                  | Cookie                           | positive / negative            | browser E2E | C/F/W/M  | cookieタグ。PR・CI                          |
| `scenario-25` | Cookie不正値: malformed vid/sidから回復                                                  | Cookie                           | negative / boundary            | browser E2E | C/F/W/M  | cookieタグ。PR・CI                          |
| `scenario-26` | Cookie利用不可: Hit送信とcontext非汚染                                                   | Cookie / collect                 | positive / negative / failure  | browser E2E | C/F/W/M  | monkeypatchによるロジック検証。PR・CI       |
| `scenario-27` | Cookie複数タブ: 初期化競合後に共有vid/sidへ収束                                          | Cookie / concurrency             | positive / boundary            | browser E2E | C/F/W/M  | 初回Hitは複数IDになり得る。PR・CI           |
| `scenario-28` | replaceStateパス変更: リロードなしでpageviewを正確に1件送信                              | SPA・History / collect           | positive / boundary            | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-29` | reload: 再読み込み後のpageviewを正確に1件送信                                            | lifecycle / collect              | positive                       | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-30` | back/forward反復: 4操作の各移動先でpageviewを正確に1件送信                               | SPA・History / lifecycle         | positive / negative / boundary | browser E2E | C/F/W/M  | 4移動のexact count。PR・CI                  |
| `scenario-31` | ページ離脱: 旧ページのtime-on-page timerはイベントを送信しない                           | lifecycle / time-on-page         | negative / boundary            | browser E2E | C/F/W/M  | PR・CI                                      |
| `scenario-32` | Config障害: HTTP 500で初期化停止・dataLayer queue保持・retryなし                         | config / dataLayer               | failure / negative             | browser E2E | C/F/W/M  | 障害注入はscenario内に限定。PR・CI          |
| `scenario-33` | Collect障害: sendBeacon=falseでfetch fallbackを1回だけ実行                               | collect / transport fallback     | failure / positive / boundary  | browser E2E | C/F/W/M  | fallback 1回。PR・CI                        |
| `scenario-34` | Collect障害: fallback fetchのHTTP 500でretry・unhandled rejectionなし                    | collect / transport fallback     | failure / negative             | browser E2E | C/F/W/M  | retry 0回。PR・CI                           |
| `scenario-35` | Tracker script障害: HTTP 404で初期化・API要求・Hitなし                                   | tag load / config / collect      | failure / negative             | browser E2E | C/F/W/M  | tracker由来error 0件。PR・CI                |

## 重要contractの両方向保証

| Contract                 | positive                                                  | negative / failure                                         | 判定     |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| tag load                 | `scenario-1`                                              | `scenario-11`、`scenario-35`                               | 両方あり |
| config                   | 発火系シナリオ                                            | `scenario-12`、`scenario-32`、`scenario-35`                | 両方あり |
| collect                  | 発火系シナリオ                                            | `scenario-12`、`scenario-34`、`scenario-35`                | 両方あり |
| transport fallback       | `scenario-33`                                             | `scenario-34`                                              | 両方あり |
| dedup                    | `scenario-8`の1000ms超再送                                | `scenario-8`、`scenario-10`、`scenario-11`                 | 両方あり |
| Cookie                   | `scenario-20`〜`scenario-24`、`scenario-27`               | `scenario-25`、`scenario-26`                               | 両方あり |
| SPA・History / lifecycle | `scenario-7`、`scenario-13`、`scenario-28`〜`scenario-30` | `scenario-14`、`scenario-18`、`scenario-19`、`scenario-31` | 両方あり |
| dataLayer                | `scenario-9`、`scenario-10`                               | `scenario-8`、`scenario-10`、`scenario-32`                 | 両方あり |

## browser E2E以外の担当

| Contract / 境界                      | 種別                           | 担当層      | 対応                                             | 頻度    |
| ------------------------------------ | ------------------------------ | ----------- | ------------------------------------------------ | ------- |
| fixtureの所有権、回収、rollback      | failure / boundary             | integration | `harness/fixture.regression-check.ts`            | quality |
| observation                          | failure / boundary             | integration | `observation.regression-check.ts`                | quality |
| Hit相関、assertion                   | positive / negative / boundary | integration | `tracking/*.regression-check.ts`                 | quality |
| Cookie helper                        | positive / negative / boundary | integration | `tests/cookie-helpers.regression-check.ts`       | quality |
| scenario選択、順序、seed             | positive / negative / boundary | integration | `harness/scenario-selection.regression-check.ts` | quality |
| run専用stack、signal、teardown       | failure / boundary             | integration | `harness/stack.regression-check.ts`              | manual  |
| E2E oracleの検出力                   | failure / boundary             | mutation    | primary 40、control-survived 1                   | manual  |
| URL、trigger、configの純粋な入力境界 | negative / boundary            | unit        | 専用基盤なし。未実装                             | 未設定  |

## gapの分類

### 対応済み

| gap                                       | 根拠                                                           |
| ----------------------------------------- | -------------------------------------------------------------- |
| query-only、hash navigation               | `scenario-18`、`scenario-19`が非対応contractを固定する         |
| URL変更を伴うreplaceState                 | `scenario-28`がpageview 1件を固定する                          |
| Cookie複数タブ                            | `scenario-27`が初期化競合後の収束を固定する                    |
| sendBeaconからfetchへのfallback           | `scenario-33`、`scenario-34`が成功経路とHTTP 500を固定する     |
| config HTTP 500、tracker.js HTTP 404      | `scenario-32`、`scenario-35`が初期化停止と副作用なしを固定する |
| reload、back/forward反復、ページ離脱timer | `scenario-29`〜`scenario-31`がexact countとtimer破棄を固定する |

「対応済み」は記載したcontractをテストが保証することを示す。query-onlyとhash navigationについては機能提供を示さない。

### 未実装

| gap                                                           | 担当層                    | 完了条件                                                       |
| ------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| configの404、timeout、abort、不正JSON・schema、初回失敗後成功 | integration + browser E2E | 初期化、queue、retry、consoleのcontractをケース別に固定する    |
| collectのsendBeacon欠落・例外、429、timeout、offline、abort   | integration + browser E2E | fallback、retry、重複、unhandled rejectionをケース別に固定する |
| tracker.jsの500、遅延、中断、壊れたscript、unknown workspace  | browser E2E               | 初期化、API要求、Hit、consoleのcontractを固定する              |
| BFCache、pagehide、visibilitychange、background、page close   | browser E2E               | pageview、trigger、timer、配送保証の範囲を決めて固定する       |
| scroll 50%未満と純粋なURL・trigger・config入力境界            | unit / integration        | ブラウザ不要の境界値テスト基盤を追加する                       |

### スコープ外・保留

| gap                                                                | 状態・理由                                               | 再判断条件                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------ |
| HTTPS、Cookie `Secure=true`、host-only送出境界、persistent context | 保留。HTTPデモの範囲外。todo 16に保持する                | HTTPS stackへ着手する時点                              |
| CSP                                                                | スコープ外。デモはCSPヘッダーを提供しない                | 本番のscript-src、connect-src、nonce方針が決まった時点 |
| consent / CMP / DNT / GPC                                          | スコープ外。製品contractがない                           | 製品要件へ追加する時点                                 |
| 管理画面E2E                                                        | スコープ外。Matrixはtrackerのcontractに限定する          | 管理画面を商用品質ゲートへ含める時点                   |
| 実Safari・実機                                                     | スコープ外。WebKitとmobile emulationは完全な代替ではない | device farmまたは実機検証を導入する時点                |
| モバイル実機の離脱インテント発火                                   | スコープ外。仕様はデスクトップのカーソル操作を前提とする | トリガー仕様を変更する時点                             |

## 運用状態

- 通常E2Eは35シナリオ×3ブラウザをCIで実行する。Cookie、単一scenario、単一browserを選択できる。
- 通常順、逆順、seed固定ランダム順を選択できる。`npm run e2e:flake`はCookieをChromiumで20回反復する。
- 成功時は診断artifactを残さない。失敗時はconsole、page error、network、Hit、スクリーンショット、trace、stack logを保存する。
- mutationカタログはCritical contractと自動照合する。2026-07-13時点の拡張カタログ実走は未完了である。
