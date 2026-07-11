// 通常 E2E の親プロセス。run 専用スタックとテスト子プロセスのライフサイクルを所有する。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stackEnvRecord, startStack } from "./harness/stack.js";
import type { E2eSuiteEntry } from "./run.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const SUITE_ENTRY: E2eSuiteEntry = path.join(ROOT, "scripts/e2e/run.ts");

function signalSuite(
  suite: ReturnType<typeof spawn> | undefined,
  signal: NodeJS.Signals
): void {
  if (suite?.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      suite.kill(signal);
    } else {
      process.kill(-suite.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function main(): Promise<void> {
  let stack: Awaited<ReturnType<typeof startStack>> | undefined;
  let suite: ReturnType<typeof spawn> | undefined;
  let interruptedSignal: NodeJS.Signals | undefined;
  let forceKillTimer: NodeJS.Timeout | undefined;
  const interrupt = (signal: NodeJS.Signals): void => {
    interruptedSignal ??= signal;
    signalSuite(suite, signal);
    forceKillTimer ??= setTimeout(() => signalSuite(suite, "SIGKILL"), 5000);
  };
  const onSigint = (): void => interrupt("SIGINT");
  const onSigterm = (): void => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    console.log("[E2E stack] starting");
    stack = await startStack();
    console.log(
      `[E2E stack] runId=${stack.runId} pid=${stack.pid ?? "unknown"} ` +
        `tracking=${stack.env.TRACKING_ORIGIN} site=${stack.env.DEMO_SITE_URL} ` +
        `db=${stack.env.DB_PATH}`
    );
    if (interruptedSignal) {
      process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
      return;
    }
    suite = spawn(process.execPath, [TSX_CLI, SUITE_ENTRY], {
      cwd: ROOT,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...stackEnvRecord(stack.env),
        E2E_RUN_ID: stack.runId,
        E2E_SUITE_CHILD: "1",
      },
      stdio: "inherit",
    });
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      suite?.once("error", reject);
      suite?.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (interruptedSignal) {
      process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
    } else if (result.signal) {
      throw new Error(`E2E suite が signal=${result.signal} で終了しました`);
    } else {
      process.exitCode = result.code ?? 1;
    }
  } finally {
    if (forceKillTimer) clearTimeout(forceKillTimer);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    signalSuite(suite, "SIGTERM");
    if (stack) {
      await stack.stop();
      console.log(`[E2E stack] cleanup complete runId=${stack.runId}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
