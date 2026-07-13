# E2E コーディングルール

エージェントと人間が `scripts/e2e/` を変更するときの正本。実行方法・シナリオ一覧・例外の詳細は [README.md](./README.md) を読む。

## 適用範囲

- 対象: `scripts/e2e/` 配下のテスト・Act・Assert・ハーネス
- 対象: [`@playwright/test` への段階移行](../../docs/e2e-runner-migration.md)
- 対象外: POM、本番アプリ本体の変更、決定済みの段階を無視した移行
- スコープ外の検証項目を勝手に広げない（非対応contractと未検証一覧は README「スコープ外」）

## 用語

- **Hit**: run 専用 DB に記録されたビーコン1件。計測 E2E の最終判定の真実源
- **Act**: デモサイト上の操作（遷移・クリック・スクロール等）
- **Assert**: 計測サーバー側の件数・Hit 検証
- **barrel**: `browser/index.ts` / `tracking/index.ts` 経由の再エクスポート。テストはここから import する

## フォルダ責務

| 場所                   | 責務     | 書くこと                                                        |
| ---------------------- | -------- | --------------------------------------------------------------- |
| `tests/`               | 検証意図 | Hit カーソル・Act 呼び出し・件数/Hit の期待                     |
| `browser/`             | Act      | Playwright の locator / `getByRole` / ページ操作                |
| `tracking/`            | Assert   | 件数待ち・`waitForNewHit`・`expectHitPayload`・匿名 ID 正規表現 |
| `harness/`             | 裏方     | スタック・セッション・定数（`config.ts`）・型                   |
| `scenarios.ts`         | 登録     | `{ name, run }` の一覧                                          |
| `playwright.config.ts` | 設定     | projects・直列実行・global setup                                |
| `playwright/`          | 実行     | fixture・`E2eContext`・薄い `test()` wrapper                    |

依存方向: `browser` は `tracking` / `tests` に依存しない。`tracking` が依存できる `harness` は `config` のみ（他の harness は禁止）。`harness/session`・`types` から `tracking` への依存は可。`harness/config`・`video` は `tracking` に依存しない。これらは `.dependency-cruiser.cjs` で error として担保する。

## 必須パターン

### 発火系の判定順

真実は Hit である。件数 API は集計の便宜であり、最終判定は Hit 単位で行う。

発火系シナリオの基本順:

1. 直前シナリオの遅延ビーコンが件数に食い込む恐れがあるときは、Act 前に `quiesceBeacons` を呼ぶ
2. `hitCursor = await tracking.captureHitCursor()`
3. Act
4. 件数を正確に +1（例: `expectEventCountExactlyIncreasedBy`）
5. `waitForNewHit`。`afterHitId` に `hitCursor` を指定する
6. `expectHitPayload`

### 自動検査

E2Eコーディング規則の自動検査では、担当の正本を [`architecture-check.ts`](./architecture-check.ts) とする。
`npm run e2e:architecture-check` は字句規則とdeep import規則を実行する。
例外は [`architecture-allowlist.json`](./architecture-allowlist.json) にファイル、規則、理由を登録する。
失敗fixtureは `npm run e2e:architecture-regression-check` が検証する。

### 自動検査しない実装規則

- `browser/actions.ts` では、クリック可能な UI に `getByRole` を優先する
- オリジン・UAトークン等の定数は `harness/config.ts` に置く
- `registeredWait` と `registeredAbortSignal` の実装は `harness/config.ts` に置き、`tracking` から re-export しない
- 固定待機を直接呼ばない。許可する待機は登録済み待機APIを使い、`architecture-allowlist.json`へ分類・理由・contract ID・基準時間・許容幅を登録する
- 待機の分類とClockの適用範囲は [`wait-strategy.md`](./wait-strategy.md) を正本とする
- 正規表現の直前に、マッチの意図とマッチする具体値の例をコメントで記載する

### 実行と隔離状態

- E2E run ごとに動的ポートと専用 DB を使う
- 同一 run のシナリオとブラウザマトリクスは直列実行する
- 検証用 fixture は全 browser project で1回だけ setup し、全 project の終了後に teardown する
- 並列ワーカーを同一 run に追加する場合、ワーカーごとに専用 DB を割り当てる

### シナリオごと context の扱い

- 常にシナリオごとに BrowserContext を開閉する（Cookie 等の隔離のため。録画の有無は問わない）
- 追加contextは `E2eContext.withSession` で作る。追加pageはmanaged sessionの `newPage` で作る
- routeはmanaged sessionの `route` で登録する。runtimeはcallback終了時に未解除routeをすべて解除する
- シナリオはBrowserContext、page、videoを直接解放しない。runtimeが生成数と解放数を照合する
- 副作用は自シナリオの page 内に閉じる。Cookie 無効化は独立contextで行い、終了後にシナリオ page が無傷であることを assert する（例: `cookie-unavailable.ts`）
- フィクスチャやトグルしたイベント状態は teardown で戻す

## 禁止事項

- Hit 検証を省略し、件数だけを最終判定にする（発火系）
- 共有 `data/db.json` のままシナリオやブラウザを並列実行する
- シナリオ page / Cookie / フィクスチャを汚したまま次シナリオへ進む
- 負のcontractテストを根拠に、README「スコープ外」の非対応機能を「対応済み」にする変更

## 新規シナリオ手順

1. `tests/<name>.ts` に `export async function test…(ctx: E2eContext)` を書く
2. デモサイト上の操作を追加するときは `browser/actions.ts` に Act を書く
3. `scenarios.ts` の `e2eScenarios` に `{ name, run }` を1行登録する
4. `npm run e2e` で確認する

テンプレートと既存シナリオ一覧は README を参照する。

## 詳細は README へ

次は README に任せる。ここへ複製しない。

- 実行コマンド・ローカル専用オプション（動画 / モバイル / ブラウザ絞り込み）
- 各 `tests/*.ts` の検証内容一覧
- 注意（`gtm-dedup` の同一 tick、`spaPushState` と popstate、Firefox `isMobile`、Cookie 汚染防止、匿名 ID 一本化）
- スコープ外（テストで固定する非対応contract、未検証項目）
