# tracking-demo — 計測タグ管理の実現性検証

## 目的

tracking-demoは、計測タグの発行、CVイベントの設定、ブラウザからの計測、結果表示までを検証するデモです。
初見の開発者は、このREADMEからローカル起動と最初の品質検証を実行できます。

## 5分での起動

前提として、Gitと[mise](https://mise.jdx.dev/)をインストールしてください。

```bash
mise install
npm install
npm start
```

`npm start`は次の2つのサーバーを起動します。

- 管理画面: http://localhost:3100/admin
- 顧客LP役のデモサイト: http://localhost:3200/

起動を終了する場合は`Ctrl+C`を押してください。

## 主要検証

初回だけ、`quality`が使うChromiumとOS依存パッケージをインストールします。

```bash
npx playwright install --with-deps chromium
npm run quality
```

利用者シナリオを全対象ブラウザで検証する場合は、Playwrightのブラウザを追加します。
続けてE2Eを実行します。

```bash
npx playwright install
npm run e2e
```

コミット履歴の秘密情報は`npm run secrets`で検査します。

## システム境界

| 境界                 | このリポジトリの責務                                                         | 外部との接点                                   |
| -------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| 管理・計測サーバー   | 管理API、計測設定、`tracker.js`配信、Hit受信、ファイルベース疑似DBを担当する | ポート3100で管理画面とHTTP APIを公開する       |
| 顧客LP役のデモサイト | タグを設置した静的なMPAとSPAを提供する                                       | 計測サーバーと別オリジンのポート3200で公開する |
| ブラウザ上の計測タグ | 計測設定を取得し、pageviewとeventを計測サーバーへ送る                        | 顧客サイトの文脈でfirst-party Cookieを管理する |

`ws`は計測設定を識別するworkspace IDです。ユーザーIDではありません。

## 非目標

- 実際のGTMコンテナ、CMP、3rd-party Cookie、フィンガープリント、クロスドメイン計測は扱いません。
- UTM、ログインユーザーとの紐付け、ハッシュルーティングは扱いません。
- 本番向けの認証・認可、レート制限、HTTPS、CSP、RDBは実装しません。
- このデモは商用環境の可用性、性能、データ保持を保証しません。

## 詳細正本へのリンク

| 情報                                      | 正本                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| 製品contractと非対応範囲                  | [`spec.md`](./spec.md)                                               |
| 公開entry point、外部入力、error contract | [`docs/boundary-inventory.md`](./docs/boundary-inventory.md)         |
| E2E contract、担当層、ブラウザ、検証状態  | [`docs/e2e-coverage-matrix.md`](./docs/e2e-coverage-matrix.md)       |
| E2Eの実行方法、構成、障害調査             | [`scripts/e2e/README.md`](./scripts/e2e/README.md)                   |
| CIの品質ゲートとツールバージョン          | [`docs/continuous-integration.md`](./docs/continuous-integration.md) |
| ミューテーションテスト（撤去済み）の経緯  | [`docs/mutation-testing-note.md`](./docs/mutation-testing-note.md)   |
| ブラウザ並列ベンチの測定結果              | [`docs/report.md`](./docs/report.md)                                 |
| worktreeを使う開発フロー                  | [`docs/development-flow.md`](./docs/development-flow.md)             |

E2E Coverage MatrixのID・名称・件数・順序はscenario catalogと機械照合します。
境界inventoryのIDはMarkdownと機械可読な台帳で照合します。
機械可読な台帳の所有者は実装と照合します。
`npm run quality`はこれらの照合とMarkdownのリンク検査を実行します。
