# E2E runner移行記録

この文書は、E2E runner移行の状態と履歴を記録する。全4段階が完了したため、この文書は完了済み移行の履歴としてarchive扱いとする。文書は削除しない。

実行方法は[`scripts/e2e/README.md`](../scripts/e2e/README.md)を参照する。現行のコーディング規則は[`scripts/e2e/AGENTS.md`](../scripts/e2e/AGENTS.md)を参照する。

## 決定

2026-07-12に、通常E2Eを`@playwright/test`へ移行すると決定した。移行は4段階に分けた。通常E2Eの移行と検出力の比較は完了した。mutation基盤は2026-07-14に撤去した。benchも2026-07-14に廃止した。

## 段階ごとの状態

| 段階                              | 状態     | 完了日     | 根拠                                                                                                                                                                                                                                                 |
| --------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 通常E2Eの移行                  | 完了     | 2026-07-12 | [`playwright/scenarios.spec.ts`](../scripts/e2e/playwright/scenarios.spec.ts)が登録済みシナリオを`test()`で包む。[`playwright/fixtures.ts`](../scripts/e2e/playwright/fixtures.ts)が相関IDと`E2eContext`を管理する。                                 |
| 2. 検出力の検証                   | 完了     | 2026-07-12 | 移行commit `fa57c1b`は、旧mutation経路でprimary 29件を全件検出し、control 3件を全件surviveした結果を記録する。                                                                                                                                       |
| 3. mutation harnessのreporter移行 | 取り消し | 2026-07-14 | mutation基盤（`scripts/mutation/`とカタログ）を撤去した。reporter移行は実施しない。経緯は[`mutation-testing-note.md`](./mutation-testing-note.md)を参照する。                                                                                        |
| 4. benchの廃止判断                | 完了     | 2026-07-14 | Playwright Test標準の実行結果サマリーが実行時間を表示するため、bench専用の計測基盤は不要と判断した。直列実行の速度面の根拠は[`report.md`](./report.md)の測定結果に記録済みである。bench基盤（`scripts/e2e/bench/`）と`npm run e2e:bench`を撤去した。 |

## 現行方針

通常E2Eは`@playwright/test`で実行する。runnerとartifactにはPlaywright Testの標準機能を使う。自作runnerにはretry、trace、screenshot、ケースtimeout、parallel worker、reporterを追加しない。

次の実行制御は採用する。

| 機能            | 現行方針 | 実装                                                                             |
| --------------- | -------- | -------------------------------------------------------------------------------- |
| scenario選択    | 採用     | `E2E_SCENARIOS`はstable IDまたは完全な名称で選択する。                           |
| tag選択         | 採用     | `E2E_TAGS`は登録タグで選択する。                                                 |
| seed固定shuffle | 採用     | `E2E_ORDER=random`と`E2E_SEED`を組み合わせる。seedをログへ出して順序を再現する。 |
| repeat          | 採用     | `E2E_REPEAT`をPlaywright Testの`repeatEach`へ渡す。                              |

scenario選択、tag選択、seed固定shuffleは[`harness/scenario-selection.ts`](../scripts/e2e/harness/scenario-selection.ts)に置く。repeatは[`playwright.config.ts`](../scripts/e2e/playwright.config.ts)に置く。利用方法はE2E READMEだけに記載する。

通常E2Eは`workers: 1`、`fullyParallel: false`、`retries: 0`で実行する。同一runはfixtureと専用DBを共有するため、直列実行を維持する。parallel workerを採用する場合は、ワーカーごとに専用DBを割り当てる。

## 完了済みの履歴

### 段階1: 通常E2Eの移行

登録済みの全シナリオを`@playwright/test`から実行する構成へ変更した。各シナリオ関数はrunnerに依存しない`(ctx) => Promise<void>`形式を維持した。相関ID、fixture、`E2eContext`の生成と破棄はPlaywright fixtureへ一本化した。

Cookie suiteの分割は、段階1の完了後に実施した。現行のCookieシナリオは独立したファイルへ分割済みである。

### 段階2: 検出力の検証

移行後のシナリオ関数に対して旧mutation経路を実行した。旧経路は`scripts/e2e/bench/suite-worker.ts`（2026-07-14撤去済み）を直接起動していた。移行commit `fa57c1b`は、primary 29件を全件検出し、control 3件を全件surviveした結果を記録する。

### 段階3: mutation harnessのreporter移行（取り消し）

mutation基盤を撤去したため、Playwright Test reporterへの移行は実施しない。

### 段階4: benchの廃止判断

Playwright Testのworker設定がbenchの計測目的を代替できるか確認した。Playwright Test標準の実行結果サマリーが実行時間を表示するため、bench専用の計測基盤は不要と判断した。直列実行の速度面の根拠は[`report.md`](./report.md)の測定結果に記録済みである。この判断に基づき、bench基盤（`scripts/e2e/bench/`）、`npm run e2e:bench`、および関連するnpm script・docs参照を撤去した。

## 不採用にした方針

### 自作runnerの継続強化

自作runnerの継続強化は採用しない。Playwright Testの標準機能と保守対象が重複するためである。

### 一括の全面移行

全面移行を一括で実施する方法は採用しない。通常E2Eと検出力検証を同時に変更すると、移行前後の検出力を比較できないためである。
