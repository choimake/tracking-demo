# tracking-demo — 計測タグ管理の実現性検証

計測タグ管理の実現性を検証するデモです。

## このデモの範囲(初見向け)

### 前提

- `spec.md` の機能(タグ設置・CV計測設定・ラベル・レポート)を TypeScript で実装しています。DB はファイルベースの疑似実装(`data/db.json`)です。
- デモサイトは顧客LP役の静的 HTML です。計測サーバー(3100)とは別オリジン(3200)で動きます。
- タグ設置は直接貼り付けです。管理画面が発行するスニペットを各ページの `<head>` に配置しています。
- `ws` は workspace ID です(例: `ws-001`)。ヒットをどの計測設定に紐づけるかの識別子であり、ユーザー ID ではありません。

### やっていること

- タグスニペットの発行・コピーを行います。
- テスト発火を行います。
- CV イベントの CRUD / 有効無効 / 5種トリガー(URL・クリック・滞在・スクロール・離脱インテント)に対応します。
- pageview / event の受信・件数表示を行います。
- first-party Cookie による匿名識別(`vid`=client_id / `sid`=session_id)を行い、全ヒットに付与します。
- ラベル・簡易レポート・レコメンドを提供します。
- SPA の History API を自動検知します。
- `tdDataLayer` 連携で手動pageviewを扱います。
- ロード前に積まれたキューを再生します。
- タグの二重設置をガードします。
- GTM 併用プロトコル(History Change 併用時の `tracker.pageview` 手動 push)に対応します。
- GTM History Change からの `tracker.pageview` push を模した E2E もあります。
- 管理画面で GTM カスタム HTML の設置手順を案内します。

| 本デモ           | 業界相当   | 意味                                                      |
| ---------------- | ---------- | --------------------------------------------------------- |
| `vid`(`_td_vid`) | client_id  | 匿名の再訪識別子(2年・ヒットごとに延長)。user_id ではない |
| `sid`(`_td_sid`) | session_id | 30分無操作で切れるセッション(ヒットごとに30分へ延長)      |

`vid` / `sid` は匿名計測用の識別子であり、認証・認可・アクセス制御には使いません。

### やっていないこと

- 実 GTM コンテナの設置・連携は行いません(デモサイトに GTM は入っていません)。
- CMP(同意管理)・3rd-party Cookie・フィンガープリント・クロスドメイン計測はしません。
- UTM / 日付(midnight)区切り・`session_start`・`session_number`・`user_id`(ログイン紐づけ)は実装しません。
- Cookie が無効(または書き込み不能)な環境では、計測ビーコン自体は送り得ますが、再訪識別・セッション継続は成立しません(ヒットごとに新しい `vid`/`sid` 相当になります)。
- 本番相当の認証・レート制限・HTTPS/CSP・RDB はありません(詳細は「本番化時の課題」を参照してください)。
- ハッシュルーティング・クエリのみ変更の再評価などには対応していません。詳細は [scripts/e2e/README.md](./scripts/e2e/README.md) の「スコープ外」を参照してください。

## 起動

```bash
npm install
npm start   # 計測サーバー(3100)と顧客LP役の静的サイト(3200)を両方起動
```

- 管理画面(計測サーバー): http://localhost:3100/admin
- デモサイト(顧客LP役): http://localhost:3200/

## 前提ツール

```bash
mise install   # Node 22 + oxlint/oxfmt/knip/dependency-cruiser/ultracite/gitleaks(CLI本体)
npm install    # express・esbuild 等のランタイム依存 + 型定義 + ultracite(設定プリセット用)
npx playwright install --with-deps chromium  # qualityのE2E基盤回帰で使うChromiumとOS依存パッケージ
```

- CLI ツール本体(oxlint/oxfmt/knip/dependency-cruiser/ultracite/gitleaks)は [mise](https://mise.jdx.dev/) で、
  アプリの依存パッケージ(express 等)は npm で管理します。管理元が異なるため両方のインストールが必要です。
- `mise install` を実行していない、または mise 自体が未導入の環境で `npm run lint`/`format`/`check`/
  `knip`/`deps`/`quality`/`secrets` を実行すると、いずれも `sh: mise: command not found` で失敗します。
  先に mise 本体をインストールし、`mise install` を実行してから npm scripts を使ってください。
- `ultracite` は package.json の devDependencies にもありますが、npm への二重導入ではありません。
  mise 版は `ultracite check`/`fix` を実行する CLI 本体そのもので、npm 版は `.oxlintrc.json` が
  `extends` で参照する設定プリセット(`node_modules/ultracite/config/...`)を取得するためだけに入れています。
  役割が異なるため両方必要です。
- `package-lock.json`/`node_modules` が管理するのは npm 側の依存(express 等)のみです。
  oxlint 等の CLI バージョンは `mise.toml` で別に固定しています。CLI を上げるときは `mise.toml` を、
  ランタイム依存を上げるときは `package.json`/`package-lock.json` を更新します(どちらか一方の更新では両方は揃いません)。

## 検証

```bash
npm run quality    # 型・静的解析・未使用コード・依存規則・E2E基盤の回帰チェック
npm run secrets    # gitleaks でコミット履歴の秘密情報スキャン
npm run secrets:staged  # ステージ済み差分だけスキャン(コミット直前用)
npm run typecheck  # 型チェック(src と scripts の両方)
npm run e2e        # run 専用サーバーとDBを自動起動するブラウザE2E。初回は npx playwright install を実行する
npm run e2e:mobile # モバイルコンテキストで既存シナリオを実行(ローカル専用)
npm run e2e:video  # 全シナリオを動画録画(ローカル専用。出力は test-results/videos/)
npm run mutation   # E2E-oracle ミューテーション(Chromium・所要約30分。手法は docs/mutation-testing.md)
```

pre-commit hook(lefthook 等)やタスクランナー(turbo 等)は導入していません。単一パッケージ構成で
`npm run quality` を直接実行すれば足りるためです。秘密情報スキャンは `npm run secrets`、
CI では `.github/workflows/gitleaks.yml` が push / PR で自動実行します。
GitHub Actionsの品質ゲートとrequired checkの設定は [`docs/continuous-integration.md`](docs/continuous-integration.md) を参照してください。

E2E の構成・各ファイルの役割は [`scripts/e2e/README.md`](scripts/e2e/README.md) を参照してください。
動画録画(`RECORD_VIDEO`)とモバイル実行(`E2E_MOBILE`)はローカル専用で、CI では使いません。
ブラウザ並列ベンチの計測結果ナレッジは [`docs/report.md`](docs/report.md) を参照してください。
E2E-oracle ミューテーションテストの手法は [`docs/mutation-testing.md`](docs/mutation-testing.md)、直近の実行結果は [`docs/mutation-report.md`](docs/mutation-report.md) を参照してください。
Git worktree を使った並列開発フローは [`docs/development-flow.md`](docs/development-flow.md) を参照してください。

E2E は Chromium / Firefox / WebKit の3エンジンを直列で実行します。実行シナリオの登録は
[`scripts/e2e/scenarios.ts`](scripts/e2e/scenarios.ts) を参照してください。検証済みの contract と未検証範囲は
[`docs/e2e-coverage-matrix.md`](docs/e2e-coverage-matrix.md) を参照してください。実行方法と障害調査手順は
[`scripts/e2e/README.md`](scripts/e2e/README.md) を参照してください。

## 構成

| パス                     | 内容                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/server.ts`          | 計測サーバー(3100)。管理API・計測受信(`/api/collect`)・tracker.js 配信・管理画面                    |
| `src/demo-server.ts`     | 顧客LP役の静的サイトサーバー(3200)。`demo-site/` を配信するだけ                                     |
| `src/main.ts`            | 上記2つをまとめて起動する開発用エントリ                                                             |
| `src/paths.ts`           | リポジトリルートのパス解決(副作用なし)                                                              |
| `demo-site/`             | タグを `<head>` に貼り付けた静的 HTML(MPA + SPA)。顧客のLPに相当                                    |
| `src/tracker/tracker.ts` | 計測スクリプト本体。起動時に esbuild で IIFE にバンドルし `/tracker.js` として配信(本番は CDN 想定) |
| `src/shared/trigger.ts`  | トリガー定義のパース/バリデーション(サーバー・トラッカー共用)                                       |
| `src/db.ts`              | ファイルベース疑似DB(初回起動時にシードデータ生成。破損時は退避して再シード)                        |
| `src/recommend.ts`       | 無効イベントへの有効化レコメンド(ルールベース)                                                      |
| `public/admin.html`      | 管理画面(イベントCRUD・検索・トグル・テスト発火・タグ設置/GTM案内・ラベル・レポート・設定モーダル)  |
| `scripts/e2e/`           | Playwright によるトラッカー実機検証(クロスオリジン構成)。詳細は `scripts/e2e/README.md`             |

## アーキテクチャ要点

- スニペット形式は GTM 準拠です(dataLayer 方式 `tdDataLayer`・非同期読み込み・`<head>` 設置)。
- サイト(3200)と計測サーバー(3100)は別オリジンです。tracker.js の設定取得は CORS 経由の fetch で行い、ビーコンは sendBeacon(プリフライトなし)で送信します。
- 匿名識別 Cookie(`_td_vid` / `_td_sid`)は tracker.js がサイト文脈で `document.cookie` に書き込みます。計測サーバーは Set-Cookie しません(クロスオリジンの 3rd-party Cookie にならないよう first-party にするためです)。属性は `Path=/; SameSite=Lax` です。`HttpOnly` は付けません(JS の `document.cookie` で読み書きするためです)。HTTP デモのため `Secure` も付けません(本番 HTTPS では `Secure` が必要です)。
- HTTPデモはCookie書き込み時に`Domain`を指定せず、`Path=/; SameSite=Lax`を指定します。HTTPでは`Secure`を指定しません。現行E2Eはlocalhostだけを使うため、host-onlyの送出境界は直接検証しません。HTTPSでの`Secure`属性と送出境界は将来のHTTPSスタックで検証します。
- SPA 対応は tracker.js が History API(pushState/replaceState/popstate)をフックして自動検知します。
  GTM の History Change トリガーから `tdDataLayer.push({event:'tracker.pageview'})` での明示発火にも対応します。
- tracker.js ロード前に `tdDataLayer` へ push された項目は、初期化時にキューを再生して処理します(再生済みのpageviewは重ねて送信しません)。
- タグが二重に設置された場合、tracker.js は2つ目以降の読み込みを無視します。
- イベント無効化は配信設定(`/api/config`)から除外し、受信側でも破棄する二重ガードです。
- テスト発火(▷)は実際の受信経路(`/api/collect`)を通る `test:true` のヒットとして記録し、計測件数・レポートには含めません(ブラウザ外のため `vid`/`sid` は空文字です)。
- 計測件数の「直近7日間」は、サーバーのローカル日付で数えた7暦日に統一しています(イベント一覧とレポートで同じ集計窓です)。

## 本番化時の課題(このデモで割り切った点)

デモ範囲の外(実 GTM・CMP・user_id など)は上記「やっていないこと」を参照してください。ここでは本番非機能の割り切りのみを挙げます。

- 管理画面・管理APIに認証がありません(本番は認証・認可が必須です)。
- 計測エンドポイントにレート制限がなく、ヒットも無制限に蓄積します(本番はレート制限・保持期間・集計テーブルが必須です)。
- 計測系 API の CORS は `*` です(タグ配信の性質上は妥当ですが、本番はワークスペースごとの許可ドメイン設定を検討してください)。
- CSP 等のセキュリティヘッダーはなく、HTTP のみです(本番は HTTPS/CSP 前提です。Cookie も `Secure` 付与が必要です)。
- first-party Cookie でも Safari ITP 等により寿命上限がかかる場合があります(デモの Max-Age=2年はブラウザ方針で短縮され得ます)。
- DB はファイル JSON の疑似実装です(本番は RDB 等へ置換します)。
