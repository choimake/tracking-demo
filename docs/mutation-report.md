# E2E-oracle ミューテーションテスト結果

## 1. 結論

kill rate は 35/36 （97.2%）でした。これはキュレーションカタログ（primary 40件中、除外4件）に対する E2E oracle（Chromium・35シナリオ）の検出力の一指標です。網羅的な変異テスト（Stryker等）の結果とは異なるため、この母集団を超えて一般化できません。survived は1件（意図的対照群1件の結果は別掲、テストギャップ候補1件、unexpected-kill 0件）です。

## 2. 実行条件

| 項目           | 値                                                               |
| -------------- | ---------------------------------------------------------------- |
| runId          | mutation-2026-07-13T01-24-00-185Z                                |
| gitShaBaseline | c2840506e0e3f315b644859333eea83ee6c95029                         |
| catalogSha256  | 6f2007c6b653dd4a3e1bdd469e2602bd9855bdb3d04a5d1bd299516977c698c3 |
| Node           | v22.23.1                                                         |
| Playwright     | 1.61.1                                                           |
| Chromium       | 149.0.7827.55                                                    |
| baseline       | green                                                            |
| 所要時間       | 6796.4s                                                          |

## 3. 全mutant結果表

| id     | class            | file                   | result   | expectedKillers | failed                                                                                                  | unexpectedKill |
| ------ | ---------------- | ---------------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| M-TR01 | primary          | src/tracker/tracker.ts | killed   | S11             | S11                                                                                                     | false          |
| M-TR02 | primary          | src/tracker/tracker.ts | killed   | S01,S18         | S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S13,S15,S16,S20,S21,S22,S23,S24,S25,S26,S27,S28,S29,S30,S33 | false          |
| M-TR03 | primary          | src/tracker/tracker.ts | killed   | S04,S15         | S15                                                                                                     | false          |
| M-TR04 | primary          | src/tracker/tracker.ts | killed   | S15             | S15                                                                                                     | false          |
| M-TR05 | primary          | src/tracker/tracker.ts | killed   | S04             | S04                                                                                                     | false          |
| M-TR06 | primary          | src/tracker/tracker.ts | killed   | S03             | S03,S15                                                                                                 | false          |
| M-TR07 | primary          | src/tracker/tracker.ts | killed   | S06             | S06                                                                                                     | false          |
| M-TR08 | primary          | src/tracker/tracker.ts | killed   | S17             | S17                                                                                                     | false          |
| M-TR09 | primary          | src/tracker/tracker.ts | killed   | S07,S08         | S07,S18,S19                                                                                             | false          |
| M-TR10 | primary          | src/tracker/tracker.ts | killed   | S13             | S13,S30                                                                                                 | false          |
| M-TR11 | primary          | src/tracker/tracker.ts | killed   | S08,S09         | S08                                                                                                     | false          |
| M-TR12 | primary          | src/tracker/tracker.ts | killed   | S08,S09         | S08,S09                                                                                                 | false          |
| M-TR13 | primary          | src/tracker/tracker.ts | killed   | S08             | S08                                                                                                     | false          |
| M-TR14 | primary          | src/tracker/tracker.ts | killed   | S10             | S10                                                                                                     | false          |
| M-TR15 | primary          | src/tracker/tracker.ts | killed   | S14             | S14                                                                                                     | false          |
| M-TR16 | primary          | src/tracker/tracker.ts | killed   | S05,S14         | S14,S31                                                                                                 | false          |
| M-TR17 | primary          | src/tracker/tracker.ts | killed   | S16             | S16                                                                                                     | false          |
| M-TR18 | primary          | src/tracker/tracker.ts | killed   | S22             | S20,S21,S22,S23,S25,S26,S27                                                                             | false          |
| M-TR19 | primary          | src/tracker/tracker.ts | killed   | S25             | S25                                                                                                     | false          |
| M-TR20 | primary          | src/tracker/tracker.ts | killed   | S07,S13         | S07,S13,S14,S16,S21,S28                                                                                 | false          |
| M-TR21 | primary          | src/tracker/tracker.ts | killed   | S02,S03,S06,S15 | S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S13,S15,S16,S18,S19,S21,S28,S30                                 | false          |
| M-TG01 | primary          | src/shared/trigger.ts  | killed   | S16             | S16                                                                                                     | false          |
| M-TG02 | primary          | src/shared/trigger.ts  | killed   | S16             | S16                                                                                                     | false          |
| M-TG03 | primary          | src/shared/trigger.ts  | killed   | S16             | S16                                                                                                     | false          |
| M-SV01 | primary          | src/server.ts          | killed   | S12             | S12                                                                                                     | false          |
| M-SV02 | primary          | src/server.ts          | killed   | S12             | S12                                                                                                     | false          |
| M-SV03 | primary          | src/server.ts          | killed   | S12             | S12                                                                                                     | false          |
| M-SV04 | primary          | src/server.ts          | timeout  | S01             | -                                                                                                       | false          |
| M-SV05 | primary          | src/server.ts          | timeout  | S01,S18         | -                                                                                                       | false          |
| M-TR26 | primary          | src/tracker/tracker.ts | killed   | S33             | S33,S34                                                                                                 | false          |
| M-TR25 | primary          | src/tracker/tracker.ts | killed   | S28             | S28                                                                                                     | false          |
| M-TR22 | primary          | src/tracker/tracker.ts | killed   | S20             | S20,S22,S23,S25,S27                                                                                     | false          |
| M-TR23 | primary          | src/tracker/tracker.ts | timeout  | S20,S21,S25     | -                                                                                                       | false          |
| M-TR24 | primary          | src/tracker/tracker.ts | survived | S26             | -                                                                                                       | false          |
| M-TR27 | primary          | src/tracker/tracker.ts | killed   | S32             | S32                                                                                                     | false          |
| M-TR28 | primary          | src/tracker/tracker.ts | killed   | S07             | S07,S13,S14,S16,S21                                                                                     | false          |
| M-TR29 | primary          | src/tracker/tracker.ts | killed   | S20             | S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S13,S15,S16,S20,S21,S22,S24,S25,S26,S27,S28,S29,S30,S33     | false          |
| M-TR30 | primary          | src/tracker/tracker.ts | killed   | S20             | S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S13,S15,S16,S20,S21,S22,S23,S24,S25,S26,S27,S28,S29,S30,S33 | false          |
| M-TR31 | primary          | src/tracker/tracker.ts | timeout  | S20             | -                                                                                                       | false          |
| M-TR32 | primary          | src/tracker/tracker.ts | killed   | S01,S29         | S01,S02,S07,S11,S21,S29,S33,S34                                                                         | false          |
| M-CS03 | control-survived | src/server.ts          | survived | -               | -                                                                                                       | false          |

## 4. survived 分析（primary）

- **M-TR24** (state-retention): 意図外ギャップ候補、または等価変異疑い。観察のみ（改善しない）。

## 5. 対照群（control-survived）

- **M-CS03**: finalResult=survived — 全 E2E シナリオは正しい ws-001 のみを送るため到達しない経路

## 6. infra-inconclusive

### 検出相当の可能性あり（mutant-suspected）

- M-SV04: mutant-suspected: green-after-restore
- M-SV05: mutant-suspected: green-after-restore
- M-TR23: mutant-suspected: green-after-restore
- M-TR31: mutant-suspected: green-after-restore

## 7. 再現手順

```bash
npm run mutation
```

カタログ: docs/mutation-catalog.json (sha256=6f2007c6b653dd4a3e1bdd469e2602bd9855bdb3d04a5d1bd299516977c698c3)
生データ: docs/mutation-results.json

## 8. 観察のみの改善候補

本ランはコード・テストを改修しない。以下は観察メモであり、実施は別タスクとする。

- M-TR24: state-retention が survived（ギャップまたは等価の可能性）
