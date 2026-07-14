# ミューテーションテストについて（撤去済み）

このリポジトリでは、E2Eをoracleとするミューテーションテスト基盤を導入し、検出力を測定した。
実現性検証デモの目的外であり、実行コストが高いため、2026-07-14に基盤を撤去した。

撤去したものは次のとおりである。

- `scripts/mutation/` ランナー
- `docs/mutation-catalog.*`、`docs/mutation-results.json`、`docs/mutation-report.md`
- `docs/mutation-archive/`
- `npm run mutation` 系スクリプト

常用しない。実行手順とカタログは残していない。
E2Eハーネス側の `*.mutation-check.ts` はハーネス回帰の一部であり、別途整理する。
