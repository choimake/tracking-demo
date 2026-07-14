# E2E テスト (`scripts/e2e/`)

`tracker.js`（計測スクリプト）を Chromium / Firefox / WebKit headless で実ブラウザ検証するテスト群。
デモサイト（顧客 LP 役・別オリジン）にタグを貼った本番相当の構成を再現する。

## 正本の分担

| 情報                                           | 正本                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| コーディング規則と変更時の制約                 | [AGENTS.md](./AGENTS.md)                                    |
| 依存方向・barrel import・循環禁止の自動検査    | `.dependency-cruiser.cjs`（`npm run deps`。quality に含む） |
| 実行シナリオの登録                             | [scenarios.ts](./scenarios.ts)                              |
| contract、担当層、ブラウザ、実行頻度、検証状態 | [E2E Coverage Matrix](../../docs/e2e-coverage-matrix.md)    |
| 実行方法と障害調査手順                         | このREADME                                                  |
| runner移行の状態と履歴                         | [E2E runner移行記録](../../docs/e2e-runner-migration.md)    |

シナリオの件数はREADMEへ記載しない。`scenarios.ts` と E2E Coverage Matrix の一致は
`npm run e2e` 開始時に `verifyScenarioCatalog` が検証する。

依存方向・barrel import・循環禁止は `npm run deps`（`.dependency-cruiser.cjs`）が検査する。`npm run quality` に含まれる。
boundary 契約は `npm run boundary:architecture-check` が検査する（quality 外）。
E2E 字句・AST の自作 architecture-check は置かない。コーディング規約の正本は [AGENTS.md](./AGENTS.md) とする。

## Fixture の所有権と回収

各 setup は UUID を生成する。検証用イベント名は UUID と作成時刻を含む。
teardown は setup が返したイベント ID だけを削除する。既存の同名イベントと seed イベントは変更しない。
teardown が一部失敗した場合も全イベントの削除を試行する。その後、未回収イベント ID を含むエラーを返す。
24時間を過ぎた所有マーカー付きイベントは次回 setup が削除する。期限内の別 run のイベントは削除しない。

fixture・teardown・stack の異常経路は通常の browser E2E 合否で検知する。
独立した fixture / teardown 回帰チェックは置かない。

global teardown は run 単位の資源を所有する。対象は全ブラウザ共通の検証用イベント、run 専用スタック、run 専用 DB である。

シナリオ teardown はテストケース単位の資源を所有する。対象は失敗時の診断 artifact、managed sessionが生成したcontext・page・route、動画である。各 teardown は相手が所有する資源を回収しない。

シナリオ teardown は次の順で処理する。

1. 失敗時に `correlated-hits` と `stack-log` を添付する。
2. 全routeを解除し、全BrowserContextをcloseして、生成数と解放数を照合する。
3. 録画が有効な場合は動画を確定または削除する。

各 teardown は自身の cleanup を全件試行する。複数の処理が失敗した場合は、全原因を `AggregateError` で伝播する。

資源台帳（生成数と解放数の照合、route リーク検出）の負経路は `npm run e2e:managed-session-check` で検証する。
通常シナリオは成功経路だけを通るため、この負経路は E2E 本体では担保できない。

## テスト方針（何を見るか）

計測 E2E の真実のソースは **Hit（run 専用 DB のヒット1件）** である。件数 API は便利な集計だが、最終判定はヒット単位で行う。

| 観点         | 見るもの                                               | 主な手段                                                                            |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| どの実行     | `ua` 末尾の run・browser・scenario 相関 ID             | シナリオ専用 `TrackingClient`                                                       |
| どの Act     | Act 前の Hit ID より後に追記されたか                   | `expectFiredHit`が取得するHitカーソル                                               |
| どのイベント | `eventId` / `type`（event or pageview）                | `expectFiredHit`の`filter`と`expectedPayload`                                       |
| 何回         | 相関 ID と Hit カーソルで隔離した件数                  | `expectHitCountAtLeast` / `expectHitCountExactly` / `expectNoHitsDuringObservation` |
| payload      | `url`・`workspaceId`・`vid`・`sid`                     | `expectFiredHit`が呼ぶ`expectHitPayload`                                            |
| ブラウザ     | `ua` にエンジン別トークン（Chrome / Firefox / Safari） | `UA_TOKEN[browserName]`                                                             |

発火系シナリオは`expectFiredHit`を使う。呼び出し側は`act`、`exactCount`、`filter`、`expectedPayload`、`hitLabel`を指定する。

helperはHitカーソル、Act、exact count、new Hit、payload検証の順序を固定する。helperは検証済みHitとHitカーソルを返す。

negative、at-most、no-hit検証は`expectFiredHit`へ統合しない。helperを使わない発火検証は、シナリオ内コメントで理由を残す。

## Hit 相関方式

通常 run は、`run ID / browser / scenario` から相関 ID を作る。Playwright は相関 ID をシナリオ専用 BrowserContext の User-Agent 末尾へ付ける。`TrackingClient` はE2E専用の観測APIを使い、User-Agent 末尾が完全一致する Hit だけを取得・集計する。同一シナリオ内では、Act 前に観測末尾の Hit ID を取得する。Act 後はその Hit ID より後だけを対象にする。この方式は Hit の `ts` とテスト実行環境の時計を相関条件に使わない。

相関 ID は Cookie の `vid` / `sid` を使わない。Cookie 無効、ID 再発行、複数タブでも BrowserContext の User-Agent は変わらないためである。既存 User-Agent は保持する。そのため、ブラウザエンジンの検証も継続する。独立 BrowserContext を作る Cookie 無効とモバイルのケースは、外側シナリオの相関 ID を明示的に継承する。

次の案は採用しなかった。

- `vid` / `sid`: Cookie の継続と再発行を検証するシナリオで循環した oracle になる。
- 時刻窓: 時計差、遅延ビーコン、未来時刻の固定除外窓に依存する。
- 専用 HTTP ヘッダー: CORS と収集サーバーの Hit 型を変更する。本番の入力面を増やす。
- URL のクエリ: 遷移時に保持されず、計測対象 URL の検証を汚す。

公開タグと収集APIは変更しない。相関情報はE2EのBrowserContextと観測APIだけで扱う。観測APIはE2E専用スタックだけで有効になる。通常起動では404を返す。runのcleanupは`stack.ts`が所有する専用DBだけを削除する。共有DBを使う構成へ変更する場合も、相関IDをcleanup条件に含める必要がある。

相関・assertion・observationの正しさは browser E2E のシナリオ合否で検知する。独立した Node 回帰チェックは置かない。

## 実行

```bash
npx playwright install   # 初回のみ: chromium / firefox / webkit
npm run e2e  # run 専用スタックを起動し、3エンジンを直列実行
```

scenario選択、tag選択、seed固定shuffle、repeatを現行方針として採用する。
目的別の選択と順序検証には次の環境変数を使う。
runnerは実行開始時に順序、seed、scenario IDをログへ出す。

```bash
npm run e2e:cookie                                      # Cookieシナリオだけ
E2E_SCENARIOS=scenario-1 npm run e2e                   # 単一シナリオだけ
E2E_BROWSERS=chromium npm run e2e                      # 単一ブラウザだけ
E2E_ORDER=reverse npm run e2e                          # 逆順
E2E_ORDER=random E2E_SEED=20260712 npm run e2e         # seed固定ランダム順
E2E_REPEAT=20 npm run e2e                              # 各シナリオを20回反復
npm run e2e:flake                                      # Cookie×Chromiumを20回
```

`E2E_SCENARIOS` はログと `scenarios.ts` に表示する `scenario-N` または完全なシナリオ名を指定する。カンマ区切りで複数指定できる。`E2E_TAGS` もカンマ区切りで指定できる。現在のタグは `cookie` である。ランダム順は再現性を保証するため `E2E_SEED` を必須とする。失敗時はログの seed を同じコマンドへ指定する。

`E2E_REPEAT`は各シナリオの反復回数を指定する。1以上の整数を指定する。

全ケースは Playwright の default mode に登録する。1ケースが失敗しても後続ケースを実行する。全ケースが同一 run の共有 fixture と専用 DB を使うため、設定は `workers: 1`、`fullyParallel: false` とする。worker ごとの専用 DB を導入するまでは同一 run 内を並列化しない。この理由は `scheduling-reason` annotation にも記録する。

`npm run e2e` は空きポートを動的に割り当てる。3100/3200 が使用中でも影響を受けない。
各 run は `data/e2e-*.tmp` を専用 DB として使う。終了時に子プロセスと専用 DB を削除する。
強制終了等で専用 DB が残った場合、次回 E2E 起動時に更新から24時間を過ぎたファイルを回収する。

Playwright Test の global setup は、run 専用スタックと検証用イベントを1回だけ準備する。全 project の終了後に global teardown が検証用イベントと専用 DB を削除する。検証用イベントの削除またはサーバープロセスの停止に失敗した場合、Playwright Test は非0で終了する。

設定は `workers: 1`、`fullyParallel: false`、`retries: 0` である。ケース timeout は60秒である。timeout 後も後続ケースと global teardown を実行する。通常 E2E はシナリオと project を直列実行する。

成功時は診断 artifact を残さない。失敗時は Playwright のケース出力へ次の artifact を保存する。

- 失敗診断manifest（`failure-diagnostics-manifest.json`）
- Playwright 標準のスクリーンショット
- シナリオが作成した全 BrowserContext を含む Playwright 標準 trace
- 相関 ID に一致する Hit
- stack log

manifestはscenario ID、browser、repeat、seed、相関ID、最後に取得したHit cursorを記録する。
manifestは失敗したassertionのactual、expected、scenario contextを記録する。
Hit、trace、スクリーンショット、stack log、console、page error、videoはpathまたは不存在理由を記録する。
一部のartifact生成が失敗した場合も、manifestは生成済みartifactと失敗理由を記録する。

trace の Console、Errors、Network タブで console、page error、通信内容を確認する。追加contextは `E2eContext.withSession` で作成する。

CI は GitHub annotation と JUnit XML でケース件数と失敗ケースを表示する。CI が失敗した場合は `test-results/` を artifact として保存する。

ルートの `playwright.config.ts` は `scripts/e2e/playwright.config.ts` を読み込む。`npm run e2e` と `npx playwright test --list` は同じ設定を使う。

### ローカル専用オプション（CI では使わない）

動画録画とモバイルコンテキスト実行は **ローカルデバッグ用**。CI ワークフローには載せない。

| 環境変数 / npm script                                | 効果                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `RECORD_VIDEO=all` / `npm run e2e:video`             | 全シナリオの動画を残す                                                            |
| `RECORD_VIDEO=on-failure` / `npm run e2e:video:fail` | FAIL 時のみ動画を残す（PASS は削除）                                              |
| `E2E_MOBILE=1` / `npm run e2e:mobile`                | 登録済みの全シナリオをモバイルコンテキストで実行。project 名に `:mobile` を付ける |
| `E2E_BROWSERS=chromium`（カンマ区切り可）            | Playwright project を絞る（未設定時は chromium,firefox,webkit）                   |

- 出力先: `test-results/videos/{browserName}/{scenario-slug}.webm`
- FAIL 時はコンソールに動画の絶対パスを出す
- macOS での開き方: `open test-results/videos/chromium/....webm`
- 常にシナリオごとに BrowserContext を開閉する（Cookie 等の隔離のため。`RECORD_VIDEO` の有無は問わない）
- 動画とモバイルは併用可（例: `E2E_MOBILE=1 RECORD_VIDEO=on-failure npm run e2e`）
- ブラウザ絞り込みとの併用例:
  ```bash
  E2E_BROWSERS=chromium RECORD_VIDEO=all npm run e2e
  E2E_MOBILE=1 E2E_BROWSERS=chromium RECORD_VIDEO=on-failure npm run e2e
  ```

`E2E_BROWSERS` は Playwright の projects に対応する。`E2E_MOBILE` はシナリオ用 fixture が BrowserContext の `viewport` と `hasTouch` を設定する。Chromium と WebKit では `isMobile` も設定する。Firefox は `isMobile` をサポートしない。`RECORD_VIDEO` は既存のファイル名と失敗時保存の契約を維持するため、シナリオ用 fixture が BrowserContext の録画を管理する。

## 地図（覚えるのは5フォルダ）

| フォルダ      | 役割                                                   | 触る頻度 |
| ------------- | ------------------------------------------------------ | -------- |
| `tests/`      | **何を検証するか**（シナリオ本体）                     | 高       |
| `browser/`    | **ページをどう操作するか**（Act）                      | 中       |
| `tracking/`   | **ビーコンが届いたかどう確認するか**（Assert）         | 中       |
| `harness/`    | 実行の裏方（スタック・セッション・定数）               | 低       |
| `playwright/` | Playwright Test との接続（fixture・薄い test wrapper） | 低       |

`scenarios.ts` は通常 E2E のシナリオ登録である。

## ディレクトリ構成

```
scripts/e2e/
├── playwright.config.ts # 直列実行・projects・global setup の設定
├── scenarios.ts        # 全シナリオの登録一覧（新規追加時はここに1行）
├── playwright/
│   ├── global-setup.ts # run 専用スタックと全ブラウザ共通 fixture の所有
│   ├── fixtures.ts     # 相関 ID・E2eContext・BrowserContext の生成と破棄
│   └── scenarios.spec.ts # scenarios.ts を test() で包む薄い wrapper
├── tests/              # シナリオ本体（1ファイル = 1ケース）
├── browser/
│   ├── navigation.ts   # 文書ナビゲーションと完了条件
│   ├── history.ts      # History API と同一文書の URL 状態
│   ├── cookie.ts       # 匿名識別 Cookie の読み書き
│   ├── input.ts        # UI・スクロール・ポインター・dataLayer入力
│   ├── failure-injection.ts # Network・Config障害注入と観測
│   └── index.ts        # barrel export
├── tracking/
│   ├── transport.ts    # HTTP要求と応答期限
│   ├── response-parser.ts # API応答の型検証
│   ├── observation-api.ts # 相関IDとHit cursorによるHit抽出
│   ├── admin-api.ts    # 管理APIの照会と変更
│   ├── client.ts       # 既存TrackingClientの統合窓口
│   ├── polling.ts      # 条件・期限・静穏の再観測
│   ├── count-assertions.ts # 件数条件の検証
│   ├── hit-payload-assertions.ts # Hit payloadと匿名IDの検証
│   ├── fire-assertion-helper.ts # 発火検証の必須順序
│   ├── log-assertions.ts # tracker logの検証
│   ├── seed-events.ts  # 固定イベント ID（ev_purchase 等）
│   └── index.ts        # barrel export
└── harness/
    ├── stack.ts        # 動的ポート・専用 DB・health 待機・cleanup
    ├── session.ts      # ページ生成・フィクスチャ setup/teardown
    ├── project-options.ts # projects とモバイルの環境変数解析
    ├── config.ts       # オリジン URL・タイムアウト・UA_TOKEN
    └── types.ts        # E2eContext 等の型
```

## データの流れ

```
Playwright Test
  ├─ playwright/global-setup.ts … run 専用スタック・共有 fixture の準備と破棄
  └─ playwright/scenarios.spec.ts
      ├─ playwright/fixtures.ts … 相関 ID・E2eContext・シナリオごとの context
      ├─ scenarios.ts           … 何を実行するか
      └─ tests/*.ts             … 各シナリオ
        ├─ browser/        … デモサイト操作（Act）
        └─ tracking/       … 件数・Hit アサーション（Assert）
```

計測 E2E は「ページを触る」と「サーバーにビーコンが届いたか読む」の二系統がある。
フォルダ名がその二系統に対応している。

依存方向の要約: `browser` ↛ `tracking` / `tests`。`tracking` ↛ `browser` / `tests`。`tracking` → `harness/config` のみ（他 harness 禁止）。`harness` ↛ `browser` / `tests`。`harness/session`・`types` → `tracking` 可。`harness/config`・`video` ↛ `tracking`。`tests` → `browser` / `tracking` は barrel（`index.ts`）限定。循環禁止（型だけの import は除外）。`.dependency-cruiser.cjs` で error として担保する（`npm run deps`。quality に含む）。

## 各フォルダの詳細

### `tests/` — シナリオ本体

| ファイル                         | 検証内容                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tag-load.ts`                    | タグ読み込み + 初回ページビュー（クロスオリジン）                                                                                                                        |
| `url-reach.ts`                   | URL 到達トリガー（MPA 遷移）                                                                                                                                             |
| `click-trigger.ts`               | クリックトリガー                                                                                                                                                         |
| `scroll-trigger.ts`              | スクロール率 50%                                                                                                                                                         |
| `time-on-page.ts`                | ページ滞在時間（検証用 2 秒イベント）                                                                                                                                    |
| `exit-intent.ts`                 | 離脱インテント                                                                                                                                                           |
| `spa-history.ts`                 | SPA: pushState 遷移                                                                                                                                                      |
| `gtm-dedup.ts`                   | GTM 併用時の二重計上防止                                                                                                                                                 |
| `datalayer-manual.ts`            | 手動 `tdDataLayer.push`                                                                                                                                                  |
| `datalayer-queue.ts`             | ロード前キュー再生                                                                                                                                                       |
| `double-tag-guard.ts`            | タグ二重設置ガード                                                                                                                                                       |
| `disabled-event.ts`              | 無効イベントの計測停止                                                                                                                                                   |
| `spa-popstate.ts`                | SPA popstate(戻る): リロードなし・pageview再送・購入イベントは戻るだけでは増えない                                                                                       |
| `time-on-page-cancel.ts`         | 滞在タイマー破棄: 閾値未満の滞在を繰り返しても発火しない                                                                                                                 |
| `fire-semantics.ts`              | 発火回数: クリックは複数回(fire)・スクロールは1PVにつき1回(fireOnce)                                                                                                     |
| `url-normalize.ts`               | URL正規化: 大文字小文字・末尾スラッシュ・日本語パス                                                                                                                      |
| `exit-intent-mobile.ts`          | モバイル(isMobile/hasTouch)ではタップ操作のみで離脱インテントが発火しない                                                                                                |
| `hash-navigation.ts`             | 非対応contract: hash navigationでは新しいpageviewを発火しない                                                                                                            |
| `query-only.ts`                  | 非対応contract: query-only遷移ではpageviewを再評価しない                                                                                                                 |
| `cookie-*.ts`                    | first-party Cookie: 発行、属性、MPA/SPA継続、期限再延長、sid/vidリセット、不正値・同名Path衝突からの回復、利用不可、複数タブ初期化後の共有IDへの収束を独立シナリオで検証 |
| `replace-state.ts`               | `replaceState` のパス変更で、リロードせずにpageviewを再送する                                                                                                            |
| `reload-pageview.ts`             | reload後に新しいドキュメントからpageviewを再送する                                                                                                                       |
| `history-traversal.ts`           | back 2回とforward 2回を直列反復し、各移動先のpageviewを再送する                                                                                                          |
| `page-leave-timer.ts`            | 計測ページから離脱した後に、旧ドキュメントの滞在タイマーがイベントを送信しない                                                                                           |
| `config-http-500.ts`             | Config HTTP 500: 初期化停止、retryなし、dataLayer queue保持、失敗ログ、page errorなし                                                                                    |
| `collect-sendbeacon-fallback.ts` | `sendBeacon=false`: fetch fallback 1回、pageview Hit 1件、page errorなし                                                                                                 |
| `collect-http-500.ts`            | fallback fetch HTTP 500: retryなし、Hitなし、unhandled rejection/page errorなし                                                                                          |
| `tracker-script-http-404.ts`     | tracker.js HTTP 404: 初期化・Config/Collect要求・Hit・tracker由来ログ・page errorなし                                                                                    |

件数保証は次の4区分で表す。複合シナリオは区間ごとの保証を併記する。

| シナリオ                          | 件数保証                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `tag-load.ts`                     | 初回pageviewを正確に1件                                                         |
| `url-reach.ts`                    | URL到達イベントを正確に1件                                                      |
| `click-trigger.ts`                | クリックイベントを正確に1件                                                     |
| `scroll-trigger.ts`               | スクロールイベントを正確に1件                                                   |
| `time-on-page.ts`                 | 滞在イベントを正確に1件                                                         |
| `exit-intent.ts`                  | 非離脱操作は観測期間中0件。離脱操作は正確に1件                                  |
| `spa-history.ts`                  | pageviewを正確に2件。購入イベントを正確に1件。同一パス操作は観測期間中0件       |
| `gtm-dedup.ts`                    | 各遷移のpageviewを正確に1件。同一tick遷移の購入イベントはsettle時点で正確に+1件 |
| `datalayer-manual.ts`             | 手動pageviewを正確に1件                                                         |
| `datalayer-queue.ts`              | pageviewを正確に1件。購入イベントを正確に1件                                    |
| `double-tag-guard.ts`             | 初回と二重設置後のpageviewを正確に1件                                           |
| `disabled-event.ts`               | 無効イベントを観測期間中0件                                                     |
| `spa-popstate.ts`                 | 戻る操作のpageviewを正確に1件。購入イベントを正確に1件                          |
| `time-on-page-cancel.ts`          | 滞在イベントを観測期間中0件                                                     |
| `fire-semantics.ts`               | クリックイベントを正確に2件。スクロールイベントを正確に1件                      |
| `url-normalize.ts`                | 各URL到達イベントを正確に1件                                                    |
| `exit-intent-mobile.ts`           | 離脱イベントを観測期間中0件                                                     |
| `hash-navigation.ts`              | hash変更後のpageviewを観測期間中0件                                             |
| `query-only.ts`                   | query-only遷移後のpageviewを観測期間中0件                                       |
| `cookie-issuance.ts`              | Cookie発行visitのpageviewを正確に1件                                            |
| `cookie-navigation-continuity.ts` | 初回とMPAを各1件。SPA初回と購入完了を合計2件。購入イベントを正確に1件           |
| `cookie-rolling-expiration.ts`    | 初回、sid期限更新、vid期限更新のpageviewを各1件。合計3件                        |
| `cookie-session-reset.ts`         | 初回とsid削除後のpageviewを各1件。合計2件                                       |
| `cookie-client-reset.ts`          | 初回とvid/sid削除後のpageviewを各1件。合計2件                                   |
| `cookie-invalid-values.ts`        | 初回と4種類の回復visitのpageviewを各1件。合計5件                                |
| `cookie-unavailable.ts`           | 通常contextで1件。Cookie利用不可contextの2回のvisitで各1件。合計3件             |
| `cookie-multitab.ts`              | 同時初期化2操作で正確に2件。収束後のvisitで正確に1件。合計3件                   |
| `replace-state.ts`                | パス変更後のpageviewを正確に1件                                                 |
| `reload-pageview.ts`              | reload後のpageviewを正確に1件                                                   |
| `history-traversal.ts`            | back/forward各操作のpageviewを正確に1件。4操作の合計を正確に4件                 |
| `page-leave-timer.ts`             | ページ離脱後の旧滞在イベントを観測期間中0件                                     |
| `config-http-500.ts`              | Config要求を正確に1回。全Hitを観測期間中0件                                     |
| `collect-sendbeacon-fallback.ts`  | fallback fetchとpageview Hitを正確に1件                                         |
| `collect-http-500.ts`             | Collect要求を正確に1回。全Hitを観測期間中0件                                    |
| `tracker-script-http-404.ts`      | tracker.js要求を正確に1回。Config/Collect要求と全Hitを観測期間中0件             |

### `browser/` — ページ操作

デモサイト（`demo-site/`）上の Playwright 操作を集約。
テストからは `import { gotoDemoPage } from '../browser/index.js'` で使う。

- `navigation.ts` — 文書を読み込むナビゲーションと完了条件を管理する。
- `history.ts` — 同一文書内のHistory APIとURL状態を操作する。
- `cookie.ts` — ページ文脈の匿名識別Cookieを読み書きする。
- `input.ts` — クリック、スクロール、ポインター、dataLayerの入力を発生させる。
- `failure-injection.ts` — 通信障害とブラウザエラーの注入・観測を管理する。

### `tracking/` — サーバー検証

- `transport.ts` — 計測APIへのHTTP要求の期限と通信エラーを管理する。
- `response-parser.ts` — 未知のJSONを検証し、E2Eが使う応答型へ変換する。
- `observation-api.ts` — 観測Hitを相関IDとHit cursorで抽出する。
- `admin-api.ts` — 管理APIでイベントを照会・変更する。
- `client.ts` — transport・観測API・管理APIを既存`TrackingClient`として統合する。
- `polling.ts` — 条件成立、期限内観測、Hit列の静穏を再観測する。
- `count-assertions.ts` — Hit・pageview・eventの件数制約を検証する。
- `hit-payload-assertions.ts` — Hit 1件の取得、識別子、payload、時刻を検証する。
- `fire-assertion-helper.ts` — 発火検証のHitカーソル、Act、exact count、new Hit、payload検証の順序を固定する。
- `log-assertions.ts` — tracker logの期待文字列を期限内に検証する。
- `seed-events.ts` — `EVENT_ID_PURCHASE` 等の定数

固定待機の分類、登録規則、Clockの適用範囲は [`wait-strategy.md`](./wait-strategy.md) を参照する。

テストからは `import { EVENT_ID_CART, expectFiredHit, quiesceBeacons } from "../tracking/index.js";` で使う。

### `harness/` — 実行の仕組み

普段あまり触らない。スタック・型・定数・セッション管理。

| ファイル             | 内容                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `stack.ts`           | 動的ポート確保、run 専用 DB、サーバー起動待ち、停止、専用 DB 回収   |
| `session.ts`         | managed session・資源台帳・fixtureのsetup/teardown                  |
| `project-options.ts` | `E2E_BROWSERS`、`E2E_MOBILE`、`BrowserName`                         |
| `config.ts`          | `TRACKING_ORIGIN`, `UA_TOKEN`, `parseRecordVideoMode`, 各種 ms 定数 |
| `types.ts`           | `E2eContext`（`browserName` 付き）                                  |

## 新しいテストを追加する手順

1. `tests/my-scenario.ts` に `export async function testMyScenario(ctx: E2eContext)` を書く
2. 必要なら変更理由が一致する `browser/` の責務モジュールに操作を追加
3. `scenarios.ts` の `e2eScenarios` に `{ name, run }` を登録
4. `npm run e2e` で確認

テンプレート（発火検証の5手順をhelperで固定する）:

```ts
import type { E2eContext } from "../harness/types.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import {
  EVENT_ID_CART,
  expectFiredHit,
  quiesceBeacons,
} from "../tracking/index.js";
import { gotoDemoPage } from "../browser/index.js";

export async function testMyScenario(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const cartCountBefore = await ctx.tracking.getEventCount7d(EVENT_ID_CART);

  await expectFiredHit({
    act: async () => {
      await gotoDemoPage(ctx.page, "/products");
      // ... Act ...
    },
    exactCount: {
      countBefore: cartCountBefore,
      eventId: EVENT_ID_CART,
      expectedDelta: 1,
      kind: "event-increase",
      label: "カート追加イベント +1",
    },
    filter: { eventId: EVENT_ID_CART, type: "event" },
    expectedPayload: {
      eventId: EVENT_ID_CART,
      type: "event",
      urlIncludes: "/products",
      workspaceId: WORKSPACE_ID,
      uaIncludes: UA_TOKEN[ctx.browserName],
    },
    hitLabel: "カート追加ヒット取得",
    tracking: ctx.tracking,
  });
}
```

## 注意

- `gtm-dedup.ts` では `pushState` と `tdDataLayer.push` を**同一 tick**で実行する必要があるため、`browser/history` と `browser/input` を個別に呼ばず `page.evaluate` にまとめている。この例外はシナリオ内コメントで理由を残す
- `tracking/observation-api.ts` の `getHitsForEvent` / `getHitsMatching` は観測API経由でrun専用DBのHitを読む
- 別 run は動的ポートと専用 DB で隔離する。同一 run 内のブラウザマトリクスとシナリオは直列実行する
- フィクスチャ（検証用イベント等）は全ブラウザ共通で 1 回 setup / 最後に teardown
- `browser/history.ts` の `spaPushState` は素の `history.pushState` を呼ぶだけでよい。tracker.js が
  `pushState` 自体をパッチして `onHistoryChange` を呼ぶため、`popstate` を手動発火すると二重処理になる
- `exit-intent-mobile.ts` の `isMobile` は Playwright の制約で **Firefox 未サポート**（コンテキスト生成が
  例外になる）。Firefox 実行時は `isMobile` を付けず `hasTouch` / `viewport` のみで代替している
- `cookie-unavailable.ts` の Cookie 無効相当は `withSession` で**独立 BrowserContext**を開く。
  `initScripts` はそのcontextだけで `document.cookie` を無効化する。シナリオ `ctx.page` は汚染しない。
  (h) 前後でシナリオ context の `_td_vid`/`_td_sid` と `document.cookie` 可読性を assert し、汚染回帰を検知する。
  Max-Age / expires 検証の許容キャップは browserName で分岐する:
  chromium / firefox は uncapped または約400日のみ（ITP 7日は許容しない＝誤キャップ回帰検知）、
  webkit は上記に加え Safari ITP 相当7日も許容する
- 匿名 ID 形式の正規表現は `tracking/hit-payload-assertions.ts` の `ANON_VID_RE` / `ANON_SID_RE` に一本化している
  （Cookieシナリオもこれを import する）
- Cookie属性E2EはHTTPデモの`Path=/`、`SameSite=Lax`、`Secure=false`を検証する。実装は`Domain`を指定しない。Playwrightの`cookies()`が返す`domain`値だけではDomain属性の有無を証明できないため、現行localhost構成ではhost-onlyの送出境界を未検証とする。HTTPSの`Secure=true`と送出境界は将来のHTTPSスタックへ移管している
- 複数タブはCookieがない同一BrowserContextで2ページのnavigationを`Promise.all`で開始する。この操作はCookie readの真の同時実行を保証しない。排他制御がないため初期化競合時の初回Hitは複数IDになり得る。テストは競合後の共有Cookieと次のHitが同じvid/sidへ収束することを要求する
- Browser LifecycleシナリオはChromium、Firefox、WebKitで同じcontractを検証する。条件付きskipはない
- `history-traversal.ts` はブラウザによる履歴移動要求の集約を避けるため、各back/forward操作の完了を待ってから
  次の操作を開始する。待機を挟まずに同時発行する高速操作は保証しない
- Network・Config障害シナリオはmanaged routeへpatternとhandlerを登録する。route IDによる明示解除に失敗しても、runtimeが残りのrouteを解除する。
  `sendBeacon` の置換とロード前 queue はシナリオ固有 Page の `addInitScript` に閉じる。
  fixture がシナリオ終了時に BrowserContext を破棄するため、後続シナリオへ障害注入は残らない。
- 障害時の console 契約は tracker 由来ログだけを固定する。Config 500は設定取得失敗を示すログ1件を要求する。
  `console.warn`のErrorオブジェクト引数はブラウザごとに文字列化が異なる。
  Firefoxでは`config HTTP 500`が`ConsoleMessage.text()`に含まれないため、HTTPステータス文字列はconsole契約に含めない。
  tracker.js 404は tracker 由来ログ0件を要求する。ブラウザ自身のnetwork error文言はエンジン差があるため固定しない。
  Collect障害シナリオは初期化完了とページビューの要求だけを固定する。配送失敗のtracker由来ログは要求しない。
  Network・Config障害シナリオはpage error 0件を要求する。Collect 500はunhandled rejectionもpage errorとして検出する。

## スコープ外

### 非対応（テストで固定）

tracker.js は hash navigation と query-only 遷移に対応していない。次の負のcontractテストは、
新しい pageview を発火しない挙動を固定する。テストの追加は tracker.js の対応済みを意味しない。

- **ハッシュルーティング（`#/path`）によるページ遷移**: tracker.js は History API
  （`pushState`/`replaceState`/`popstate`）のみを検知し、`hashchange` はフックしていない。
  シナリオ「非対応contract: hash navigationでは新しいpageviewを発火しない」（`hash-navigation.ts`）は
  hash の変更で新しい pageview を発火しない非対応contractを固定する
- **クエリパラメータのみの変更**: URL到達トリガーは `location.pathname` のみで照合するため、
  パスが同一でクエリだけ変わるケースは新しいページビューとして再評価されない。
  シナリオ「非対応contract: query-only遷移ではpageviewを再評価しない」（`query-only.ts`）は
  query-only 遷移で pageview を再評価しない非対応contractを固定する

### 非対応（部分的な負のcontractのみ検証）

- **モバイル実機・実ブラウザでの離脱インテント発火**: 離脱インテントはデスクトップのカーソル操作
  （`mouseout`）前提のトリガー。`exit-intent-mobile.ts` はタップ操作のみでは「発火しない」ことの確認に
  限定しており、モバイルでの発火自体は非対応

### 未検証

- hard reload、SPA遷移直後のreload
- BFCache復帰（`pageshow.persisted`）、`pagehide`、`visibilitychange`、background中のtime-on-page
- prerender時の送信抑制
- 動的追加要素とkeyboard activationによるクリック。子要素クリックと連打クリックは既存シナリオで検証済み
- Configの404・timeout・connection abort・malformed JSON・events欠落・未知trigger・不正selector・初回失敗後の成功・
  tracker.jsより遅い応答・大量イベント・重複event ID・境界値。HTTP 500を安定した代表ケースとして選んだ。
  malformed JSONの例外文言にはブラウザ差がある。遅延と大量データは障害契約の代表ケースを優先したため対象外とした。
- Collectの429・timeout・offline・abort・unload直前送信、`sendBeacon`不存在・例外。
  HTTP 500と`sendBeacon=false`を安定した代表ケースとして選んだ。offline・abort・unloadはブラウザ差とflakeを避けるため対象外とした。
  `sendBeacon`例外時は現行trackerがfallbackへ進まないため、このタスクでは契約として固定しない。
- tracker.jsの500・遅延・中断・壊れたscript、IDなしタグ後の正常タグ、unknown workspace、二重ロード、異なるoriginからのロード。
  HTTP 404を安定した配信失敗の代表ケースとして選んだ。中断と壊れたscriptはブラウザごとのerror通知差を避けるため対象外とした。
- CSP環境、管理画面のE2E

hard reloadは、キャッシュ無効化を3ブラウザで同じ条件に固定するPlaywright APIがないため未検証とする。
BFCache、prerender、backgroundのライフサイクルは、採用条件や実行抑制をheadlessの3ブラウザで安定して再現できないため未検証とする。
`pagehide`と`visibilitychange`は、上記ライフサイクルを安定して再現できる仕組みを導入してから検証する。
