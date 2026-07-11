# E2E-oracle ミューテーションテスト結果

## 1. 結論

kill rate は 29/29 （100.0%）でした。これはキュレーションカタログ（primary 29件中、除外0件）に対する E2E oracle（Chromium・18シナリオ）の検出力の一指標であり、網羅的な変異テスト（Stryker等）の結果とは異なるため、この母集団を超えて一般化はできません。survived は0件（意図的対照群3件の結果は別掲、テストギャップ候補0件、unexpected-kill 0件）です。

## 2. 実行条件

| 項目           | 値                                                               |
| -------------- | ---------------------------------------------------------------- |
| runId          | mutation-2026-07-11T07-12-44-110Z                                |
| gitShaBaseline | aa4fc78e11f2ed25bdf2951d07010a342d8bea42                         |
| catalogSha256  | 293b7034622a9fba096e1fc0b2eeb011c5d5dbe58cbdafd7b24534f6385458e8 |
| Node           | v22.21.1                                                         |
| Playwright     | 1.61.1                                                           |
| Chromium       | 149.0.7827.55                                                    |
| baseline       | green                                                            |
| 所要時間       | 1890.9s                                                          |

## 3. 全mutant結果表

| id     | class            | file                   | result   | expectedKillers | failed                                                          | unexpectedKill |
| ------ | ---------------- | ---------------------- | -------- | --------------- | --------------------------------------------------------------- | -------------- |
| M-TR01 | primary          | src/tracker/tracker.ts | killed   | S11             | S11                                                             | false          |
| M-TR02 | primary          | src/tracker/tracker.ts | killed   | S01,S18         | S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S13,S15,S16,S18     | false          |
| M-TR03 | primary          | src/tracker/tracker.ts | killed   | S04,S15         | S15                                                             | false          |
| M-TR04 | primary          | src/tracker/tracker.ts | killed   | S15             | S15                                                             | false          |
| M-TR05 | primary          | src/tracker/tracker.ts | killed   | S04             | S04                                                             | false          |
| M-TR06 | primary          | src/tracker/tracker.ts | killed   | S03             | S03,S15                                                         | false          |
| M-TR07 | primary          | src/tracker/tracker.ts | killed   | S06             | S06                                                             | false          |
| M-TR08 | primary          | src/tracker/tracker.ts | killed   | S17             | S17                                                             | false          |
| M-TR09 | primary          | src/tracker/tracker.ts | killed   | S07,S08         | S07                                                             | false          |
| M-TR10 | primary          | src/tracker/tracker.ts | killed   | S13             | S13                                                             | false          |
| M-TR11 | primary          | src/tracker/tracker.ts | killed   | S08,S09         | S08                                                             | false          |
| M-TR12 | primary          | src/tracker/tracker.ts | killed   | S08,S09         | S08,S09                                                         | false          |
| M-TR13 | primary          | src/tracker/tracker.ts | killed   | S08             | S08                                                             | false          |
| M-TR14 | primary          | src/tracker/tracker.ts | killed   | S10             | S10                                                             | false          |
| M-TR15 | primary          | src/tracker/tracker.ts | killed   | S14             | S14                                                             | false          |
| M-TR16 | primary          | src/tracker/tracker.ts | killed   | S05,S14         | S08,S14                                                         | false          |
| M-TR17 | primary          | src/tracker/tracker.ts | killed   | S16             | S16                                                             | false          |
| M-TR18 | primary          | src/tracker/tracker.ts | killed   | S18             | S18                                                             | false          |
| M-TR19 | primary          | src/tracker/tracker.ts | killed   | S18             | S18                                                             | false          |
| M-TR20 | primary          | src/tracker/tracker.ts | killed   | S07,S13         | S07,S13,S14,S16,S18                                             | false          |
| M-TR21 | primary          | src/tracker/tracker.ts | killed   | S02,S03,S06,S15 | S02,S03,S04,S05,S06,S07,S08,S10,S13,S15,S16,S18                 | false          |
| M-TG01 | primary          | src/shared/trigger.ts  | killed   | S16             | S16                                                             | false          |
| M-TG02 | primary          | src/shared/trigger.ts  | killed   | S16             | S16                                                             | false          |
| M-TG03 | primary          | src/shared/trigger.ts  | killed   | S16             | S16                                                             | false          |
| M-SV01 | primary          | src/server.ts          | killed   | S12             | S12                                                             | false          |
| M-SV02 | primary          | src/server.ts          | killed   | S12             | S12                                                             | false          |
| M-SV03 | primary          | src/server.ts          | killed   | S12             | S12                                                             | false          |
| M-SV04 | primary          | src/server.ts          | killed   | S01             | S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S13,S15,S16,S18     | false          |
| M-SV05 | primary          | src/server.ts          | killed   | S01,S18         | S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S12,S13,S15,S16,S18 | false          |
| M-CS01 | control-survived | src/tracker/tracker.ts | survived | -               | -                                                               | false          |
| M-CS02 | control-survived | src/tracker/tracker.ts | survived | -               | -                                                               | false          |
| M-CS03 | control-survived | src/server.ts          | survived | -               | -                                                               | false          |

## 4. survived 分析（primary）

（なし）

## 5. 対照群（control-survived）

- **M-CS01**: finalResult=survived（想定どおり survived なら健全）
- **M-CS02**: finalResult=survived（想定どおり survived なら健全）
- **M-CS03**: finalResult=survived（想定どおり survived なら健全）

## 6. infra-inconclusive

（なし）

## 7. 再現手順

```bash
npm run mutation
```

カタログ: docs/mutation-catalog.json (sha256=293b7034622a9fba096e1fc0b2eeb011c5d5dbe58cbdafd7b24534f6385458e8)
生データ: docs/mutation-results.json

## 8. 観察のみの改善候補

本ランはコード・テストを改修しない。以下は観察メモであり、実施は別タスクとする。

- 特記なし（primary はすべて killed、対照群は survived）
