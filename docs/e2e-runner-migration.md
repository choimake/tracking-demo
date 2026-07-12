# E2E runner 移行方針

この文書は、E2E runner の移行方針と実施順序の正本である。`scripts/e2e/` を変更する開発者は、着手前にこの文書を確認する。

## 決定

2026-07-12 に、E2E runner の最終到達点を `@playwright/test` への全面移行と決定した。移行は4段階に分けて実施する。段階移行は全面移行を順番に実施する方法であり、最終到達点を変更しない。

各段階は、前の段階の完了条件を満たしてから開始する。段階を飛ばす実装や、複数段階を一括で実施する変更を禁止する。

## 現在の実装ルール

- 自作 runner へ retry、trace、screenshot、ケース timeout、シナリオ filter、parallel worker、reporter を実装しない
- runner と artifact の機能は `@playwright/test` の標準機能で提供する
- seed 再現と繰り返し実行は `@playwright/test` の標準機能で提供する
- Cookie suite の分割は段階1の完了後に行う
- mutation harness は段階2の検証が終わるまで旧経路を維持する
- bench の縮小・廃止は段階3の完了後に判断する

上記の実装ルールは、移行方針の決定後も適用する。移行先が提供する機能を自作 runner に追加してから移行する作業は行わない。

## 採用理由

`@playwright/test` は retry、trace、screenshot、ケース timeout、シナリオ filter、parallel worker、reporter、seed 再現、繰り返し実行の機能を提供する。これらの機能を自作 runner に再実装する必要はない。

E2E 資産の中核は runner に依存しない。Hit oracle、`TrackingClient`、独自 assertion、fixture 管理、`(ctx) => Promise<void>` 形式のシナリオ関数は移行後も利用できる。

## 不採用にした方針

### 自作 runner の継続強化

自作 runner の継続強化は採用しない。現在の自作 runner に必要な機能を追加すると、`@playwright/test` の標準機能を再実装することになる。保守対象も増えるため、全面移行より利点が少ない。

### 一括の全面移行

全面移行を一括で実施する方法は採用しない。mutation harness を同時に書き直しても、E2E の検出力は向上しない。また、旧経路を同時に失うと、移行前後の検出力を比較できない。巨大な差分は、1タスク・1worktree・独立レビューの運用にも適さない。

## 移行計画

### 段階1: 通常 E2E の移行

18シナリオを `@playwright/test` から実行する。各シナリオ関数は runner に依存しない `(ctx) => Promise<void>` 形式を維持する。各関数を薄い `test()` ラッパーで包む。

相関 ID の採番、fixture の setup と teardown、`E2eContext` の組み立ては Playwright fixture に一本化する。段階2で `suite-worker.ts` が `scenarios.ts` を import できる構造を維持する。

完了条件:

- 18シナリオを `@playwright/test` 経由で実行できる
- 18シナリオの既存 assertion がすべて成功する
- `scenarios.ts` から runner 非依存のシナリオ関数を引き続き参照できる
- 相関 ID、fixture、`E2eContext` の生成と破棄を Playwright fixture が担う

### 段階2: 検出力の検証

移行後のシナリオ関数に対して、旧経路の mutation harness を実行する。mutation harness は `suite-worker.ts` を直接 spawn し、stdout 最終行の JSON を結果として受け取る契約を維持する。

完了条件:

- 旧経路の mutation を最後まで実行できる
- 移行前に killed だった全 mutant が移行後も killed になる
- 検出結果に差がある場合は、段階3へ進まず原因を解消する

### 段階3: mutation harness の reporter 移行

mutation harness を Playwright の機械可読 reporter ベースへ移行する。mutation 実行では `retries: 0` を強制する。auto-retry が成功すると mutant の失敗を最終結果から隠し、killed である mutant を survive と誤判定するためである。

完了条件:

- mutation harness が機械可読 reporter からシナリオ別の成否を取得する
- mutation harness が `suite-worker.ts` の直接 spawn と stdout 最終行の JSON 契約に依存しない
- mutation harness が mutation 実行時に `retries: 0` を強制する
- 段階2と同じ mutant の検出結果を得る

### 段階4: bench の廃止判断

`scripts/e2e/bench/` は、直列実行と並列実行の時間を計測するために存在する。`@playwright/test` の worker 設定がこの役割を代替できるかを段階3の完了後に確認する。

完了条件:

- worker 設定で必要な実行時間を計測できるかを確認する
- bench を維持、縮小、廃止のいずれにするかを決定する
- 決定に合わせて npm script と関連文書を更新する後続タスクを定義する

## 将来タスクへの影響

### Cookie suite の分割

`cookie-identity.ts` の複合ケースを独立ケースへ分割する作業は、シナリオ interface を変更する。段階1が interface と Playwright fixture の境界を確定するため、分割作業は段階1の完了後に開始する。

### runner と artifact の整備

retry、trace、screenshot、ケース timeout、シナリオ filter、parallel worker、reporter は `@playwright/test` の標準機能で提供する。自作 runner 側には実装しない。parallel worker を有効にするときは、[`scripts/e2e/AGENTS.md`](../scripts/e2e/AGENTS.md) の隔離ルールに従い、ワーカーごとに専用 DB を割り当てる。

### テスト選択と flake 検出

seed 再現と繰り返し実行は `@playwright/test` の標準機能で提供する。独自の選択機構や繰り返し実行機構は追加しない。
