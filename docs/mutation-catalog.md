# 変異カタログ（人間向け要約）

機械可読の正本は [`mutation-catalog.json`](mutation-catalog.json) です。ランナーは JSON のみを読み、SHA-256 も JSON に対して取ります。

## 内訳

| class | 件数 |
|-------|------|
| primary | 29 |
| control-survived | 3 |
| 合計 | 32 |

## フィールド

各レコード: `id`, `file`, `operator`, `change`, `beforeString`, `afterString`, `expectedKillers`, `class`（control は `rationale` 付き）。

適用は `beforeString` → `afterString` のみ。`change` は説明用。

## シナリオカバレッジ

S01–S18 それぞれを `expectedKillers` に含む primary が最低1件あること（ランナー起動時に検証）。

## 対照群

| id | 根拠 |
|----|------|
| M-CS01 | README: sendBeacon 失敗時 fetch フォールバックは E2E 未検証 |
| M-CS02 | README: replaceState 単体は E2E 未検証 |
| M-CS03 | E2E は常に正しい ws を送るため到達しない |

手法の読み方は [`mutation-testing.md`](mutation-testing.md) を参照。
