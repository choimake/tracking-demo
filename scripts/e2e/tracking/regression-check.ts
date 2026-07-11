import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { runAssertionsMutationCheck } from "./assertions.mutation-check.js";
import { runAssertionsRegressionCheck } from "./assertions.regression-check.js";
import { runCorrelationRegressionCheck } from "./correlation.regression-check.js";

// 子プロセスで実行するファイルを knip に示す。ここでは関数を呼ばない。
void runAssertionsRegressionCheck;
void runCorrelationRegressionCheck;
void runAssertionsMutationCheck;

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const entries = [
  "./correlation.regression-check.ts",
  "./assertions.regression-check.ts",
  "./assertions.mutation-check.ts",
];

for (const entry of entries) {
  const entryPath = fileURLToPath(new URL(entry, import.meta.url));
  const result = spawnSync(process.execPath, [tsxCli, entryPath], {
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${entry} が終了コード ${result.status} で失敗`);
  }
}
