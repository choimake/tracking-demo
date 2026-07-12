# 変異カタログ（人間向け要約）

機械可読の正本は [`mutation-catalog.json`](mutation-catalog.json) です。ランナーは JSON のみを読み、SHA-256 も JSON に対して取ります。

## 内訳

| class            | 件数 |
| ---------------- | ---- |
| primary          | 40   |
| control-survived | 1    |
| 合計             | 41   |

## フィールド

各レコード: `id`, `file`, `operator`, `change`, `beforeString`, `afterString`, `expectedKillers`, `class`（control は `rationale` 付き）。

適用は `beforeString` → `afterString` のみ。`change` は説明用。

## Critical contractカバレッジ

ランナーはTODO 13の各contractとmutant IDを双方向に照合します。カタログだけを変更した場合は起動時に停止します。

- exact count、dedup window境界
- Cookie名、vid/sid入れ替え、再発行条件、Max-Age再延長、Cookie利用不可時のID再利用
- pushState、replaceState、popstateの個別hook、timer cleanup
- sendBeacon fallback、payloadのvid/sid個別欠落
- enabled filter、fireOnce guard、double-tag guard、Config失敗時のqueue保持
- `known-gap-control`: E2Eで意図的に到達しない対照群

## 対照群

| id     | 根拠                                     |
| ------ | ---------------------------------------- |
| M-CS03 | E2E は常に正しい ws を送るため到達しない |

`M-TR25`（replaceState）と`M-TR26`（sendBeacon fallback）は、対応E2E追加に伴いprimaryへ昇格しました。

手法の読み方は [`mutation-testing.md`](mutation-testing.md) を参照。
