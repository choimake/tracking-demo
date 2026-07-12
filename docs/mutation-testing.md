# E2E-oracle ミューテーションテスト — 手法ナレッジ

ユニットテストがなく、機能検証が Playwright E2E に集約されているコードベースで、**テストが意図した欠陥を検出できるか**を測るための手法メモです。1回の実行結果（kill rate の数値表）は書きません。数値は [`mutation-report.md`](mutation-report.md) を参照してください。

## 1. いつ使うか

- E2E が「仕様の真実源」になっており、カバレッジ％だけではテストの強さが分からないとき。
- Stryker + ユニットの定石が使えない（または今回は導入しない）とき。
- ゴールが「ギャップの発見と記録」であり、すぐテストを増やして潰すことではないとき。

使わない／別物:

- 全自動変異の網羅率（Stryker 相当）の代替にはならない。母集団はキュレーションした mutant に限定する。
- ブラウザエンジン差の検証（Firefox / WebKit）は本手法の軸ではない（必要なら別実験）。

## 2. 採用した契約（本リポジトリ）

| 項目   | 内容                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| Oracle | `E2E_BROWSERS=chromium`・登録済み全シナリオ（[`scripts/e2e/scenarios.ts`](../scripts/e2e/scenarios.ts)）   |
| 方式   | シナリオ対応のキュレーション変異（自動乱数変異ではない）                                                   |
| 件数   | primary 40 + control-survived 1 = **41**（カタログとcontract一覧を起動時に照合）                           |
| 隔離   | bench の `PORT` / `SITE_PORT` / `DB_PATH`（[`scripts/e2e/bench/stack.ts`](../scripts/e2e/bench/stack.ts)） |
| 改善   | しない。survived は観察としてレポートに残すのみ                                                            |
| 適用   | カタログの `beforeString` / `afterString` のみ（要約 `change` は適用に使わない）                           |

```
kill_rate = killed_primary_count / (primary_total - excluded_primary_count)
```

- `primary_total` = 実行時のカタログ内primary件数
- 除外: リトライ後も `timeout` / `error` / `skipped` の primary
- `control-survived` は分母に含めない（既知の E2E スコープ外の対照群）

## 3. 結果の読み方

| 結果                             | 意味                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **killed**                       | スイートが fail し、かつ失敗シナリオが `expectedKillers` と交差する                                                      |
| **survived**                     | スイートが pass、または fail しても期待シナリオと交差しない                                                              |
| **unexpected-kill**              | fail したが期待シナリオ以外だけが落ちた。enum 上は survived + フラグ                                                     |
| **control-survived が survived** | 対照群として健全（未検証経路のまま）                                                                                     |
| **control-survived が killed**   | 前提崩れ。カタログ／スコープの再検討サイン                                                                               |
| **mutant-suspected**             | timeout/error 確定後、変異なし再実行が green → 変異がハング等を起こした疑い（分母除外は維持し、killed には読み替えない） |

一般化禁止: 「このコードベースの変異検出力は ○%」とは言わない。言えるのは「実行時カタログに対する Chromium E2E の検出力」まで。

## 4. 運用上の落とし穴

1. **tracker.js はサーバー起動時に1回だけバンドル**される（[`src/server.ts`](../src/server.ts)）。mutant 適用後はプロセス再起動が必須。mutant ごとに `startStack` する設計で満たす。
2. **ソースファイルは共有可変状態**のため並列実行禁止（ポート隔離だけでは足りない）。
3. **`data/bench-*` は `.gitignore` 対象**。`git status --porcelain` が空でも残骸は残る。実行後にディレクトリ削除を目視確認する。
4. **`beforeString` はファイル内にちょうど1箇所**。0/2箇所以上は apply 失敗（infra-error）。
5. **既存 `runSuiteWorker` は子プロセスハンドルを返さない**。180秒タイムアウトの SIGKILL は `scripts/mutation/` 側の薄い spawn ラッパーで行う（bench 本体は改修しない）。
6. **killed / survived はリトライしない**（恣意的な結果書き換え防止）。timeout / error のみ最大2回再試行。
7. **oracle（`scripts/e2e/tests/`）は一切変更しない**。ランナーと docs だけが評価用の新規物。

## 5. 関連ファイル

| ファイル                                                | 役割                                     |
| ------------------------------------------------------- | ---------------------------------------- |
| [`mutation-catalog.json`](mutation-catalog.json)        | 凍結カタログ（機械可読・SHA-256 対象）   |
| [`mutation-catalog.md`](mutation-catalog.md)            | カタログの人間向け要約                   |
| `mutation-results.json`                                 | 本実行後に生成する現行カタログの生データ |
| [`mutation-report.md`](mutation-report.md)              | 現行カタログの実測状態または結果         |
| [`scripts/mutation/run.ts`](../scripts/mutation/run.ts) | 評価用ランナー                           |
| [`report.md`](report.md)                                | E2E 並列ベンチ（本手法とは別軸）         |

## 6. 再現の入口

```bash
# 前提: git clean、Playwright chromium 済み
npx playwright install chromium

# 変異ラン（baseline → カタログ全件 → JSON/レポート生成はランナーに含む）
npm run mutation
```

詳細な操作的定義・エスカレーション条件は実行計画（Cursor plan）および本ディレクトリの report / catalog を正とする。
