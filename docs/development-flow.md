# Git worktree 並列開発フロー

複数担当・複数エージェントが互いの未コミット変更を上書きせずに並列開発するための手順書。タスクごとに作業ディレクトリ・branch・index を分離する。日本語文書の書き方とリポジトリ横断ルールは [AGENTS.md](../AGENTS.md) を読む。

## 基準 commit ポリシー

- worktree はローカル main の commit hash を基準に作成する。origin/main を基準にしない
- 基準 commit hash は依頼文に記録する
- 基準に origin へ未 push の commit を含む場合は、依頼文にその旨を明示する
- push は統合タイミングでリポジトリ所有者がまとめて実施する

基準 hash は main worktree で `git rev-parse --short main` で確認する。例: 本フロー策定時点のローカル main は `6ee57b9` であり、origin/main より commit 2 件分（`d3b063c`、`6ee57b9`）先行している。

## worktree 運用ルール

- 1タスク・1branch・1worktree を守る
- 1worktree を複数担当で共有しない
- 同じ branch を複数 worktree で使用しない
- main worktree（このリポジトリ本体）はレビューと統合専用にする
- 担当は割り当てられた TODO の範囲外を変更しない
- merge 済みの worktree だけを削除する

### 配置と命名

- worktree の配置先: `../tracking-demo-worktrees/<branch名のslug>`
- branch 命名: `task/<todo番号>-<slug>`（例: `task/01-hermetic-stack`）

### コマンド

worktree を作成する。

```bash
git worktree add ../tracking-demo-worktrees/task-01-hermetic-stack -b task/01-hermetic-stack <基準hash>
```

作成した worktree で依存パッケージをインストールする。`node_modules` は worktree 間で共有されない。

```bash
cd ../tracking-demo-worktrees/task-01-hermetic-stack
npm install
```

merge 済みの worktree を削除する。削除後に不要な branch が残っていないことも確認する。

```bash
git worktree remove ../tracking-demo-worktrees/task-01-hermetic-stack
git branch -D task/01-hermetic-stack
git worktree prune
git branch --list 'task/*'
```

worktree の一覧を確認する。削除後に不要な entry が残っていないことをこのコマンドで確認する。

```bash
git worktree list
```

## タスク受け渡し

`memory/`（ローカル作業メモ、Git 管理外）は worktree に現れない。TODO 本文は依頼文に全文を含めて担当へ渡す。

依頼文のテンプレート:

```markdown
## タスク依頼

- branch 名: task/<todo番号>-<slug>
- 基準 commit hash: <hash>（origin 未 push の commit を含む: はい / いいえ）
- 対象 TODO: <TODO 番号とタイトル。本文を以下に全文引用する>
- 変更可能範囲: <変更してよいファイル・ディレクトリを列挙する>
- 受け入れ基準: <検証可能な条件を列挙する>
```

### 完了報告

担当は完了報告に次の項目を含める。

- commit（hash とメッセージ）
- 変更ファイル
- 実行コマンド
- 結果（テスト・quality の成否）
- 残課題
- 競合可能性（他タスクと衝突しうるファイル・領域）

## 統合ルール

- task branch → integration branch → main の順に統合する
- 基盤タスク（例: タスク01 Hermetic stack）は依存順を崩さない
- 統合前に基準 branch との差分と受け入れ基準を確認する
- 競合解消時に一方の assertion や negative case を消さない
- 統合前に `npm run quality` と対象 E2E（`npm run e2e`）を通す。qualityの構成は [継続的インテグレーション](continuous-integration.md) を参照する
- integration branch で全体を検証してから main へ統合する

## 制約（現時点の非対応）

- worktree はファイル編集の衝突を防ぐが、ポート・DB・外部サービス・CPU の共有資源は隔離しない
- `npm start` は計測サーバーに既定ポート 3100、デモサイトに既定ポート 3200 を使う。複数 worktree から同時に起動しない
- repository 全体へ作用する Git 操作（`git worktree add` / `git worktree remove`、branch 削除）を、他 worktree の長時間検証と同時に行わない
- ignored/untracked ファイル（`memory/`、`.env` 等）は worktree 間で共有されない
- 各 worktree で `npm install` を個別に実行する必要がある

## 動作確認済みの事項

以下はローカル main `6ee57b9` を基準に実地検証した結果である。

- `git worktree add ../tracking-demo-worktrees/task-verify-a -b task/verify-a 6ee57b9` の形式で worktree を作成できる
- 一方の worktree の未コミット変更は、他方の `git status` に現れない
- `git worktree remove` → `git branch -D` → `git worktree prune` の順で削除すると、`git worktree list` に不要な entry が残らない
- `memory/` は worktree に現れない
