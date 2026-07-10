import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BrowserName } from "../harness/config.js";
import type { BrowserTiming } from "./report.js";
import type { StackEnv } from "./stack.js";
import { startStack, stackEnvRecord } from "./stack.js";
import { elapsedMs, nowMs } from "./timing.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const WORKER_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "suite-worker.ts"
);

export interface SuiteWorkerResult {
  browsers: BrowserTiming[];
  status: "pass" | "fail";
}

/** スタック env を継承した子プロセスでシナリオを実行(モジュールキャッシュ隔離) */
export function runSuiteWorker(
  browsers: BrowserName[],
  stackEnv: StackEnv
): Promise<SuiteWorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", WORKER_SCRIPT, "--browsers", browsers.join(",")],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ...stackEnvRecord(stackEnv),
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
      // ワーカーの進捗ログを親にも出す
      process.stderr.write(c);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const last = lines.at(-1);
      if (!last) {
        reject(
          new Error(
            `suite-worker が結果を出力しませんでした (code=${code})\n${stderr}`
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(last) as SuiteWorkerResult;
        resolve(parsed);
      } catch (error) {
        reject(
          new Error(
            `suite-worker の JSON 解析に失敗: ${String(error)}\nstdout=${stdout}\nstderr=${stderr}`
          )
        );
      }
    });
  });
}

export interface SerialRunOptions {
  runId: string;
  browsers: BrowserName[];
  iteration: number;
  warmup: boolean;
}

/** 1スタック上でブラウザを直列実行し、suite_wall / browser / case を計測する */
export async function runSerialIteration(opts: SerialRunOptions): Promise<{
  iteration: number;
  warmup: boolean;
  suite_wall_ms: number;
  status: "pass" | "fail";
  browsers: BrowserTiming[];
}> {
  const wallStart = nowMs();
  const stack = await startStack({
    runId: opts.runId,
    workerIndex: 0,
    dbLabel: "serial",
  });
  try {
    const result = await runSuiteWorker(opts.browsers, stack.env);
    return {
      iteration: opts.iteration,
      warmup: opts.warmup,
      suite_wall_ms: elapsedMs(wallStart),
      status: result.status,
      browsers: result.browsers,
    };
  } finally {
    await stack.stop();
  }
}
