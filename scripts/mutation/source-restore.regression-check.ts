import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertSourceBaseline,
  captureSourceBaseline,
  persistAndRethrowSourceRestoreError,
  restoreSourceFile,
  runAttemptWithFatalRestore,
  SourceRestoreError,
} from "./source-restore.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-source-restore-"));

try {
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/tracked.ts"), "export const a = 1;\n");
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "src/tracked.ts"], { cwd: root });
  fs.writeFileSync(
    path.join(root, "src/untracked.ts"),
    "export const b = 2;\n"
  );

  const baseline = captureSourceBaseline(root);
  assert.deepEqual(baseline.paths, ["src/tracked.ts", "src/untracked.ts"]);

  fs.writeFileSync(
    path.join(root, "src/untracked.ts"),
    "export const b = null;\n"
  );
  assert.throws(() => assertSourceBaseline(baseline), /src\/untracked\.ts/);
  restoreSourceFile(baseline, "src/untracked.ts");
  assertSourceBaseline(baseline);

  fs.writeFileSync(path.join(root, "src/added.ts"), "export const c = 3;\n");
  assert.throws(
    () => assertSourceBaseline(baseline),
    /mutation開始時から変化しました/
  );
  fs.rmSync(path.join(root, "src/added.ts"));
  assertSourceBaseline(baseline);

  let cleanupCalled = false;
  const restoreFailure = await runAttemptWithFatalRestore({
    file: "src/missing.ts",
    run: async () => "attempt-completed",
    restore: () => restoreSourceFile(baseline, "src/missing.ts"),
    cleanup: async () => {
      cleanupCalled = true;
    },
  }).catch((error: unknown) => error);
  assert(restoreFailure instanceof SourceRestoreError);
  assert.equal(restoreFailure.file, "src/missing.ts");
  assert.equal(restoreFailure.attempt, "attempt-completed");
  assert.match(String(restoreFailure.cause), /復元元がありません/);
  assert.equal(cleanupCalled, true);

  const fatalEvents: string[] = [];
  assert.throws(
    () =>
      persistAndRethrowSourceRestoreError(restoreFailure, () => {
        fatalEvents.push("results-persisted");
      }),
    (error: unknown) => {
      assert.equal(error, restoreFailure);
      return true;
    }
  );
  assert.deepEqual(fatalEvents, ["results-persisted"]);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("mutation source restore regression check: OK");
