import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface SourceBaseline {
  readonly root: string;
  readonly paths: readonly string[];
  readonly contents: ReadonlyMap<string, Buffer>;
  readonly status: string;
}

/** Gitが管理するsrcとignore対象外の未追跡srcを列挙する。 */
export function listSourcePaths(root: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src/"],
    { cwd: root, encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .toSorted();
}

function sourceStatus(root: string): string {
  return execFileSync("git", ["status", "--porcelain", "--", "src/"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

/** mutation開始時のsrcを復元台帳へ保存する。 */
export function captureSourceBaseline(root: string): SourceBaseline {
  const paths = listSourcePaths(root);
  return {
    root,
    paths,
    contents: new Map(
      paths.map((file) => [file, fs.readFileSync(path.join(root, file))])
    ),
    status: sourceStatus(root),
  };
}

/** srcがmutation開始時の状態と一致することを確認する。 */
export function assertSourceBaseline(baseline: SourceBaseline): void {
  const currentStatus = sourceStatus(baseline.root);
  if (currentStatus !== baseline.status) {
    throw new Error(
      `src/ の差分がmutation開始時から変化しました:\n開始時:\n${baseline.status}\n現在:\n${currentStatus}`
    );
  }

  const currentPaths = listSourcePaths(baseline.root);
  if (
    currentPaths.length !== baseline.paths.length ||
    currentPaths.some((file, index) => file !== baseline.paths[index])
  ) {
    throw new Error(
      `src/ のファイル一覧がmutation開始時から変化しました:\n開始時:\n${baseline.paths.join("\n")}\n現在:\n${currentPaths.join("\n")}`
    );
  }

  for (const [file, expected] of baseline.contents) {
    const current = fs.readFileSync(path.join(baseline.root, file));
    if (!current.equals(expected)) {
      throw new Error(`src/ の内容がmutation開始時から変化しました: ${file}`);
    }
  }
}

/** 1ファイルをmutation開始時の内容へ戻す。 */
export function restoreSourceFile(
  baseline: SourceBaseline,
  file: string
): void {
  const contents = baseline.contents.get(file);
  if (!contents) {
    throw new Error(`mutation開始時の復元元がありません: ${file}`);
  }
  fs.writeFileSync(path.join(baseline.root, file), contents);
}

export class SourceRestoreError<T> extends Error {
  readonly attempt: T | undefined;
  readonly file: string;

  constructor(file: string, cause: unknown, attempt: T | undefined) {
    super(`mutation後の復元に失敗しました: ${file}`, { cause });
    this.name = "SourceRestoreError";
    this.file = file;
    this.attempt = attempt;
  }
}

/** 結果を保存してから復元失敗を再送出する。 */
export function persistAndRethrowSourceRestoreError<T>(
  error: SourceRestoreError<T>,
  persist: () => void
): never {
  persist();
  throw error;
}

interface AttemptWithRestoreOptions<T> {
  readonly file: string;
  readonly run: () => Promise<T>;
  readonly restore: () => void;
  readonly cleanup: () => Promise<void>;
}

/** 復元とcleanupを実行し、復元失敗を呼び出し元へ通知する。 */
export async function runAttemptWithFatalRestore<T>({
  file,
  run,
  restore,
  cleanup,
}: AttemptWithRestoreOptions<T>): Promise<T> {
  let attemptResult: { readonly value: T } | undefined;
  let runError: unknown;
  try {
    attemptResult = { value: await run() };
  } catch (error) {
    runError = error;
  }

  let restoreError: unknown;
  try {
    restore();
  } catch (error) {
    restoreError = error;
  }

  let cleanupError: unknown;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (restoreError) {
    throw new SourceRestoreError(file, restoreError, attemptResult?.value);
  }
  if (runError) {
    throw runError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  if (!attemptResult) {
    throw new Error("attemptの結果がありません");
  }
  return attemptResult.value;
}
