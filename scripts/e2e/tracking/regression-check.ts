import { spawnSync } from "node:child_process";

import { runCorrelationRegressionCheck } from "./correlation.regression-check.js";

// 子プロセスで実行するファイルを静的解析ツールにも示す。ここでは関数を呼ばない。
void runCorrelationRegressionCheck;

const result = spawnSync(
  "npx",
  ["tsx", "scripts/e2e/tracking/correlation.regression-check.ts"],
  { stdio: "inherit" }
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(
    `correlation regression check が終了コード ${result.status} で失敗`
  );
}
