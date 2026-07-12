# E2E テスト (`scripts/e2e/`)

`tracker.js`（計測スクリプト）を Chromium / Firefox / WebKit headless で実ブラウザ検証するテスト群。
デモサイト（顧客 LP 役・別オリジン）にタグを貼った本番相当の構成を再現する。

詳細なコーディングルールは [AGENTS.md](./AGENTS.md) を参照。
E2E runner の方針と移行順序は、[E2E runner 移行方針](../../docs/e2e-runner-migration.md) を参照。

## Fixture の所有権と回収

各 setup は UUID を生成する。検証用イベント名は UUID と作成時刻を含む。
teardown は setup が返したイベント ID だけを削除する。既存の同名イベントと seed イベントは変更しない。
teardown が一部失敗した場合も全イベントの削除を試行する。その後、未回収イベント ID を含むエラーを返す。
24時間を過ぎた所有マーカー付きイベントは次回 setup が削除する。期限内の別 run のイベントは削除しない。

ブラウザ不要の fixture 回帰チェックは `npm run e2e:fixture-check` で実行する。

## テスト方針（何を見るか）

計測 E2E の真実のソースは **Hit（run 専用 DB のヒット1件）** である。件数 API は便利な集計だが、最終判定はヒット単位で行う。

| 観点         | 見るもの                                               | 主な手段                                                                                                     |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| どの実行     | `ua` 末尾の run・browser・scenario 相関 ID             | シナリオ専用 `TrackingClient`                                                                                |
| どの Act     | Act 前の Hit ID より後に追記されたか                   | `captureHitCursor` + `afterHitId`                                                                            |
| どのイベント | `eventId` / `type`（event or pageview）                | `waitForNewHit` + `expectHitPayload`                                                                         |
| 何回         | 相関 ID と Hit カーソルで隔離した件数                  | `expectHitCountAtLeast` / `expectHitCountExactly` / `expectHitCountAtMost` / `expectNoHitsDuringObservation` |
| payload      | `url`・`workspaceId`・`vid`・`sid`                     | `expectHitPayload`（末尾で常に `expectAnonIdsPresent`。`vid`/`sid` 完全一致はオプション）                    |
| ブラウザ     | `ua` にエンジン別トークン（Chrome / Firefox / Safari） | `UA_TOKEN[browserName]`                                                                                      |

`expectHitCountAtMost` は現在、回帰契約のみで使用する。回帰契約と mutation-check の検証対象として維持する。

発火系シナリオの基本パターン: **Hit カーソル取得 → Act → 相関済み件数を正確に +1 → waitForNewHit → expectHitPayload**。

## Hit 相関方式

通常 run は、`run ID / browser / scenario` から相関 ID を作る。Playwright は相関 ID をシナリオ専用 BrowserContext の User-Agent 末尾へ付ける。`TrackingClient` はE2E専用の観測APIを使い、User-Agent 末尾が完全一致する Hit だけを取得・集計する。同一シナリオ内では、Act 前に観測末尾の Hit ID を取得する。Act 後はその Hit ID より後だけを対象にする。この方式は Hit の `ts` とテスト実行環境の時計を相関条件に使わない。

相関 ID は Cookie の `vid` / `sid` を使わない。Cookie 無効、ID 再発行、複数タブでも BrowserContext の User-Agent は変わらないためである。既存 User-Agent は保持する。そのため、ブラウザエンジンの検証も継続する。独立 BrowserContext を作る Cookie 無効とモバイルのケースは、外側シナリオの相関 ID を明示的に継承する。

次の案は採用しなかった。

- `vid` / `sid`: Cookie の継続と再発行を検証するシナリオで循環した oracle になる。
- 時刻窓: 時計差、遅延ビーコン、未来時刻の固定除外窓に依存する。
- 専用 HTTP ヘッダー: CORS と収集サーバーの Hit 型を変更する。本番の入力面を増やす。
- URL のクエリ: 遷移時に保持されず、計測対象 URL の検証を汚す。

公開タグと収集APIは変更しない。相関情報はE2EのBrowserContextと観測APIだけで扱う。観測APIはE2E専用スタックだけで有効になる。通常起動では404を返す。runのcleanupは`stack.ts`が所有する専用DBだけを削除する。共有DBを使う構成へ変更する場合も、相関IDをcleanup条件に含める必要がある。

`npm run quality` は Node レベルの相関・assertion回帰チェックと assertion Mutation Testing を自動実行する。単独で確認する場合は次のコマンドを実行する。

```bash
npm run e2e:tracking-check
npm run e2e:observation-check
```

## 実行

```bash
npx playwright install   # 初回のみ: chromium / firefox / webkit
npm run e2e  # run 専用スタックを起動し、3エンジンを直列実行
```

`npm run e2e` は空きポートを動的に割り当てる。3100/3200 が使用中でも影響を受けない。
各 run は `data/e2e-*.tmp` を専用 DB として使う。終了時に子プロセスと専用 DB を削除する。
強制終了等で専用 DB が残った場合、次回 E2E 起動時に更新から24時間を過ぎたファイルを回収する。

Playwright Test の global setup は、run 専用スタックと検証用イベントを1回だけ準備する。全 project の終了後に global teardown が検証用イベントと専用 DB を削除する。検証用イベントの削除またはサーバープロセスの停止に失敗した場合、Playwright Test は非0で終了する。

設定は `workers: 1`、`fullyParallel: false`、`retries: 0` である。ケース timeout は無効である。通常 E2E はシナリオと project を直列実行する。

ルートの `playwright.config.ts` は `scripts/e2e/playwright.config.ts` を読み込む。`npm run e2e` と `npx playwright test --list` は同じ設定を使う。

### ローカル専用オプション（CI では使わない）

動画録画とモバイルコンテキスト実行は **ローカルデバッグ用**。CI ワークフローには載せない。

| 環境変数 / npm script                                | 効果                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `RECORD_VIDEO=all` / `npm run e2e:video`             | 全シナリオの動画を残す                                                        |
| `RECORD_VIDEO=on-failure` / `npm run e2e:video:fail` | FAIL 時のみ動画を残す（PASS は削除）                                          |
| `E2E_MOBILE=1` / `npm run e2e:mobile`                | 既存 18 シナリオをモバイルコンテキストで実行。project 名に `:mobile` を付ける |
| `E2E_BROWSERS=chromium`（カンマ区切り可）            | Playwright project を絞る（未設定時は chromium,firefox,webkit）               |

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

`scenarios.ts` は通常 E2E と mutation の suite-worker が共有するシナリオ登録である。

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
│   ├── actions.ts      # デモサイト操作（getByRole ベース）
│   └── index.ts        # barrel export
├── tracking/
│   ├── client.ts       # 計測サーバー API クライアント / Hit 直読み
│   ├── assertions.ts   # 件数・ヒット単位の着弾待ち・期待値検証
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

依存方向の要約: `browser` ↛ `tracking` / `tests`。`tracking` → `harness/config` のみ（他 harness 禁止）。`harness/session`・`types` → `tracking` 可。`harness/config`・`video` ↛ `tracking`。`.dependency-cruiser.cjs` で error として担保する。

## 各フォルダの詳細

### `tests/` — シナリオ本体

| ファイル                 | 検証内容                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tag-load.ts`            | タグ読み込み + 初回ページビュー（クロスオリジン）                                                                                                                                                                                                    |
| `url-reach.ts`           | URL 到達トリガー（MPA 遷移）                                                                                                                                                                                                                         |
| `click-trigger.ts`       | クリックトリガー                                                                                                                                                                                                                                     |
| `scroll-trigger.ts`      | スクロール率 50%                                                                                                                                                                                                                                     |
| `time-on-page.ts`        | ページ滞在時間（検証用 2 秒イベント）                                                                                                                                                                                                                |
| `exit-intent.ts`         | 離脱インテント                                                                                                                                                                                                                                       |
| `spa-history.ts`         | SPA: pushState 遷移                                                                                                                                                                                                                                  |
| `gtm-dedup.ts`           | GTM 併用時の二重計上防止                                                                                                                                                                                                                             |
| `datalayer-manual.ts`    | 手動 `tdDataLayer.push`                                                                                                                                                                                                                              |
| `datalayer-queue.ts`     | ロード前キュー再生                                                                                                                                                                                                                                   |
| `double-tag-guard.ts`    | タグ二重設置ガード                                                                                                                                                                                                                                   |
| `disabled-event.ts`      | 無効イベントの計測停止                                                                                                                                                                                                                               |
| `spa-popstate.ts`        | SPA popstate(戻る): リロードなし・pageview再送・購入イベントは戻るだけでは増えない                                                                                                                                                                   |
| `time-on-page-cancel.ts` | 滞在タイマー破棄: 閾値未満の滞在を繰り返しても発火しない                                                                                                                                                                                             |
| `fire-semantics.ts`      | 発火回数: クリックは複数回(fire)・スクロールは1PVにつき1回(fireOnce)                                                                                                                                                                                 |
| `url-normalize.ts`       | URL正規化: 大文字小文字・末尾スラッシュ・日本語パス                                                                                                                                                                                                  |
| `exit-intent-mobile.ts`  | モバイル(isMobile/hasTouch)ではタップ操作のみで離脱インテントが発火しない                                                                                                                                                                            |
| `cookie-identity.ts`     | first-party Cookie: (a)〜(g) 発行・継続・再延長・区切り・リセット。(h) Cookie無効相当(**独立 BrowserContext** + シナリオ page の Cookie 非汚染 assert)。expires は browserName 別: chromium/firefox=uncapped\|約400日、webkit=それに加え ITP 相当7日 |

件数保証は次の4区分で表す。複合シナリオは区間ごとの保証を併記する。

| シナリオ                 | 件数保証                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| `tag-load.ts`            | 初回pageviewを正確に1件                                                         |
| `url-reach.ts`           | URL到達イベントを正確に1件                                                      |
| `click-trigger.ts`       | クリックイベントを正確に1件                                                     |
| `scroll-trigger.ts`      | スクロールイベントを正確に1件                                                   |
| `time-on-page.ts`        | 滞在イベントを正確に1件                                                         |
| `exit-intent.ts`         | 非離脱操作は観測期間中0件。離脱操作は正確に1件                                  |
| `spa-history.ts`         | pageviewを正確に2件。購入イベントを正確に1件。同一パス操作は観測期間中0件       |
| `gtm-dedup.ts`           | 各遷移のpageviewを正確に1件。同一tick遷移の購入イベントはsettle時点で正確に+1件 |
| `datalayer-manual.ts`    | 手動pageviewを正確に1件                                                         |
| `datalayer-queue.ts`     | pageviewを正確に1件。購入イベントを正確に1件                                    |
| `double-tag-guard.ts`    | 初回と二重設置後のpageviewを正確に1件                                           |
| `disabled-event.ts`      | 無効イベントを観測期間中0件                                                     |
| `spa-popstate.ts`        | 戻る操作のpageviewを正確に1件。購入イベントを正確に1件                          |
| `time-on-page-cancel.ts` | 滞在イベントを観測期間中0件                                                     |
| `fire-semantics.ts`      | クリックイベントを正確に2件。スクロールイベントを正確に1件                      |
| `url-normalize.ts`       | 各URL到達イベントを正確に1件                                                    |
| `exit-intent-mobile.ts`  | 離脱イベントを観測期間中0件                                                     |
| `cookie-identity.ts`     | 各Actのpageviewを最低1件。SPA区間は最低2件。購入完了イベントを正確に1件         |

### `browser/` — ページ操作

デモサイト（`demo-site/`）上の Playwright 操作を集約。
テストからは `import { gotoDemoPage } from '../browser/index.js'` で使う。

### `tracking/` — サーバー検証

- `client.ts` — 管理API呼び出し、観測APIの応答検証、相関IDとHitカーソルによるHit抽出
- `assertions.ts` — 4区分の件数helper、`quiesceBeacons`、`waitForNewHit`、`expectHitPayload`（末尾で `expectAnonIdsPresent`）、匿名ID正規表現
- `seed-events.ts` — `EVENT_ID_PURCHASE` 等の定数

テストからは `import { EVENT_ID_CART, quiesceBeacons } from '../tracking/index.js'` で使う。

### `harness/` — 実行の仕組み

普段あまり触らない。スタック・型・定数・セッション管理。

| ファイル             | 内容                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `stack.ts`           | 動的ポート確保、run 専用 DB、サーバー起動待ち、停止、専用 DB 回収              |
| `session.ts`         | `createE2eSession`, `createE2ePage`, `setupE2eFixtures`, `teardownE2eFixtures` |
| `project-options.ts` | `E2E_BROWSERS`、`E2E_MOBILE`、`BrowserName`                                    |
| `config.ts`          | `TRACKING_ORIGIN`, `UA_TOKEN`, `parseRecordVideoMode`, 各種 ms 定数            |
| `types.ts`           | `E2eContext`（`browserName` 付き）                                             |

## 新しいテストを追加する手順

1. `tests/my-scenario.ts` に `export async function testMyScenario(ctx: E2eContext)` を書く
2. 必要なら `browser/actions.ts` に操作を追加
3. `scenarios.ts` の `e2eScenarios` に `{ name, run }` を登録
4. `npm run e2e` で確認

テンプレート（件数 + ヒット単位の 5 観点）:

```ts
import type { E2eContext } from "../harness/types.js";
import { UA_TOKEN, WORKSPACE_ID } from "../harness/config.js";
import {
  EVENT_ID_CART,
  quiesceBeacons,
  expectEventCountExactlyIncreasedBy,
  waitForNewHit,
  expectHitPayload,
} from "../tracking/index.js";
import { gotoDemoPage } from "../browser/index.js";

export async function testMyScenario(ctx: E2eContext): Promise<void> {
  await quiesceBeacons(ctx.tracking);
  const cartCountBefore = await ctx.tracking.getEventCount7d(EVENT_ID_CART);
  const hitCursor = await ctx.tracking.captureHitCursor();

  await gotoDemoPage(ctx.page, "/products");
  // ... Act ...

  await expectEventCountExactlyIncreasedBy(
    ctx.tracking,
    EVENT_ID_CART,
    cartCountBefore,
    1,
    "カート追加イベント +1"
  );
  const hit = await waitForNewHit(
    ctx.tracking,
    { afterHitId: hitCursor, eventId: EVENT_ID_CART, type: "event" },
    "カート追加ヒット取得"
  );
  expectHitPayload(hit, {
    eventId: EVENT_ID_CART,
    type: "event",
    urlIncludes: "/products",
    workspaceId: WORKSPACE_ID,
    uaIncludes: UA_TOKEN[ctx.browserName],
  });
}
```

## 注意

- `gtm-dedup.ts` では `pushState` と `tdDataLayer.push` を**同一 tick**で実行する必要があるため、`browser/actions` を個別に呼ばず `page.evaluate` にまとめている
- `tracking/client.ts` の `getHitsForEvent` / `getHitsMatching` は API 経由ではなく run 専用 DB を直読みする
- 別 run は動的ポートと専用 DB で隔離する。同一 run 内のブラウザマトリクスとシナリオは直列実行する
- フィクスチャ（検証用イベント等）は全ブラウザ共通で 1 回 setup / 最後に teardown
- `browser/actions.ts` の `spaPushState` は素の `history.pushState` を呼ぶだけでよい。tracker.js が
  `pushState` 自体をパッチして `onHistoryChange` を呼ぶため、`popstate` を手動発火すると二重処理になる
- `exit-intent-mobile.ts` の `isMobile` は Playwright の制約で **Firefox 未サポート**（コンテキスト生成が
  例外になる）。Firefox 実行時は `isMobile` を付けず `hasTouch` / `viewport` のみで代替している
- `cookie-identity.ts` の (h) Cookie 無効相当は `createE2eSession` で**独立 BrowserContext**を開き、
  その context にだけ `addInitScript` で `document.cookie` を無効化する（シナリオ `ctx.page` を汚染しない）。
  (h) 前後でシナリオ context の `_td_vid`/`_td_sid` と `document.cookie` 可読性を assert し、汚染回帰を検知する。
  Max-Age / expires 検証の許容キャップは browserName で分岐する:
  chromium / firefox は uncapped または約400日のみ（ITP 7日は許容しない＝誤キャップ回帰検知）、
  webkit は上記に加え Safari ITP 相当7日も許容する
- 匿名 ID 形式の正規表現は `tracking/assertions.ts` の `ANON_VID_RE` / `ANON_SID_RE` に一本化している
  （`cookie-identity.ts` もこれを import する）

## スコープ外（未検証・非対応）

- **ハッシュルーティング（`#/path`）によるページ遷移**: tracker.js は History API
  （`pushState`/`replaceState`/`popstate`）のみを検知し、`hashchange` はフックしていない
- **クエリパラメータのみの変更**: URL到達トリガーは `location.pathname` のみで照合するため、
  パスが同一でクエリだけ変わるケースは新しいページビューとして再評価されない
- **モバイル実機・実ブラウザでの離脱インテント発火**: 離脱インテントはデスクトップのカーソル操作
  （`mouseout`）前提のトリガー。`exit-intent-mobile.ts` はタップ操作のみでは「発火しない」ことの確認に
  限定しており、モバイルでの発火自体は非対応
- `replaceState` 単体の挙動、`sendBeacon` 失敗時の `fetch` フォールバック経路、CSP環境、管理画面のE2E
