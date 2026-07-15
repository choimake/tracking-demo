# 継続的インテグレーション

GitHub ActionsはpushとPull Requestで3系統のworkflowを実行する。

## workflowの責務

| workflow       | 固定job名     | 責務                                                |
| -------------- | ------------- | --------------------------------------------------- |
| `quality.yml`  | `quality`     | 型、静的解析、未使用コード、依存方向を検証する      |
| `e2e.yml`      | `browser e2e` | Chromium、Firefox、WebKitで利用者シナリオを検証する |
| `gitleaks.yml` | `gitleaks`    | Git履歴に含まれる秘密情報を検出する                 |

`quality`は`npm run quality`を実行する。
このコマンドは次の4段を直列で実行する。

1. `typecheck`
2. `check`（ultracite / oxlint）
3. `knip`
4. `deps`（dependency-cruiser。循環依存と E2E の依存方向・barrel import）

`gitleaks`は品質検証とブラウザE2Eに秘密情報検出を重複させない。

## ツールバージョンの正本

`quality.yml`は`jdx/mise-action`を使う。
このActionはリポジトリ直下の`mise.toml`を読み、Nodeと品質CLIを導入する。
Node、oxfmt、oxlint、knip、dependency-cruiser、ultraciteのバージョンは`mise.toml`で確認する。
npmパッケージのバージョンは`package.json`と`package-lock.json`で確認する。
workflowにはNodeと品質CLIのバージョンを記載しない。

ローカルの`npm run secrets`は`mise.toml`で固定したgitleaks CLIを使う。
CIの`gitleaks.yml`は`gitleaks/gitleaks-action@v3`が提供する実行環境を使う。
この差は秘密情報検出を独立したworkflowに保つために許容する。

`quality`はブラウザを起動しない。
Chromiumの導入は`e2e.yml`が担当する。

## required checkの登録

リポジトリ管理者は次の手順で`quality`をPull Requestのrequired checkに登録する。

1. `quality.yml`をdefault branchへ反映する。
2. GitHub Actionsで`quality`workflowを1回成功させる。
3. GitHubのリポジトリ画面で **Settings > Rules > Rulesets** を開く。
4. default branchを対象とするbranch rulesetを開く。rulesetがない場合は作成する。
5. **Require status checks to pass** を有効にする。
6. status checkとして`quality`を追加する。sourceにはGitHub Actionsを選ぶ。
7. rulesetをActiveにして保存する。

required checkに登録する文字列はworkflow名ではなく、固定job名の`quality`である。
jobをmatrixへ変更しない。
jobの`name`を変更する場合は、rulesetのrequired checkも同じ変更で更新する。

設定後にPull Requestを作成する。
Pull RequestのChecksで`quality`が必須と表示されることを確認する。
検証用Pull Requestで`npm run quality`を一時的に失敗させ、mergeが禁止されることを確認する。
確認後は検証用の変更を取り消す。
