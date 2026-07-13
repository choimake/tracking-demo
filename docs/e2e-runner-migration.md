# E2E runner移行記録

この文書は、E2E runner移行の状態と履歴を記録する。移行は完了していない。段階3と段階4が残っているため、この文書はarchiveしない。

実行方法は[`scripts/e2e/README.md`](../scripts/e2e/README.md)を参照する。現行のコーディング規則は[`scripts/e2e/AGENTS.md`](../scripts/e2e/AGENTS.md)を参照する。

## 決定

2026-07-12に、通常E2Eを`@playwright/test`へ移行すると決定した。移行は4段階に分けた。通常E2Eの移行と検出力の比較は完了した。mutation harnessの移行とbenchの扱いが残っている。

## 段階ごとの状態

| 段階                              | 状態   | 完了日     | 根拠                                                                                                                                                                                                                 |
| --------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 通常E2Eの移行                  | 完了   | 2026-07-12 | [`playwright/scenarios.spec.ts`](../scripts/e2e/playwright/scenarios.spec.ts)が登録済みシナリオを`test()`で包む。[`playwright/fixtures.ts`](../scripts/e2e/playwright/fixtures.ts)が相関IDと`E2eContext`を管理する。 |
| 2. 検出力の検証                   | 完了   | 2026-07-12 | 移行commit `fa57c1b`は、旧mutation経路でprimary 29件を全件検出し、control 3件を全件surviveした結果を記録する。                                                                                                       |
| 3. mutation harnessのreporter移行 | 未着手 | -          | [`scripts/mutation/run.ts`](../scripts/mutation/run.ts)は`bench/suite-worker.ts`を直接起動し、標準出力のJSONを読む。                                                                                                 |
| 4. benchの廃止判断                | 未着手 | -          | [`scripts/e2e/bench/`](../scripts/e2e/bench/)と`npm run e2e:bench`が残る。段階3の完了後に判断する。                                                                                                                  |

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

移行後のシナリオ関数に対して旧mutation経路を実行した。旧経路は`suite-worker.ts`を直接起動する。移行commit `fa57c1b`は、primary 29件を全件検出し、control 3件を全件surviveした結果を記録する。この結果を段階3の比較基準とする。

## 未完了の計画

### 段階3: mutation harnessのreporter移行

mutation harnessをPlaywright Testの機械可読reporterへ移行する。mutation実行では`retries: 0`を強制する。retryが成功すると、失敗したmutantをsurviveと誤判定するためである。

完了条件は次のとおりである。

1. mutation harnessが機械可読reporterからシナリオ別の成否を取得する。
2. mutation harnessが`suite-worker.ts`の直接起動と標準出力末尾のJSONに依存しない。
3. mutation実行時に`retries: 0`を強制する。
4. 段階2と同じ既存mutantの検出結果を得る。

### 段階4: benchの廃止判断

Playwright Testのworker設定がbenchの計測目的を代替できるか確認する。確認後にbenchを維持、縮小、廃止のいずれかに決定する。

完了条件は次のとおりである。

1. worker設定で必要な実行時間を計測できるか確認する。
2. benchの扱いを決定する。
3. 決定に合わせてnpm scriptと関連文書を更新する。

段階3と段階4が完了した時点で、この文書を「完了済み移行の履歴」としてarchive扱いにする。文書は削除しない。

## 不採用にした方針

### 自作runnerの継続強化

自作runnerの継続強化は採用しない。Playwright Testの標準機能と保守対象が重複するためである。

### 一括の全面移行

全面移行を一括で実施する方法は採用しない。通常E2Eとmutation harnessを同時に変更すると、移行前後の検出力を比較できないためである。
