import fs from "node:fs/promises";
import path from "node:path";

import { stackEnvRecord, startStack } from "../harness/stack.js";

const FIXTURES_ENV = "E2E_FIXTURES";

/** run 専用スタックと全ブラウザ共通 fixture を所有する。 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  let interruptedSignal: NodeJS.Signals | undefined;
  const onSigint = (): void => {
    interruptedSignal = "SIGINT";
  };
  const onSigterm = (): void => {
    interruptedSignal = "SIGTERM";
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  console.log("[E2E stack] starting");
  const stackLogPath = path.resolve(
    "test-results",
    `e2e-stack-${Date.now()}-${process.pid}.log`
  );
  await fs.mkdir(path.dirname(stackLogPath), { recursive: true });
  await fs.writeFile(stackLogPath, "");
  process.env.E2E_STACK_LOG_PATH = stackLogPath;
  const stack = await startStack({ logPath: stackLogPath }).finally(() => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  });
  for (const [name, value] of Object.entries(stackEnvRecord(stack.env))) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  process.env.E2E_RUN_ID = stack.runId;
  console.log(
    `[E2E stack] runId=${stack.runId} pid=${stack.pid ?? "unknown"} ` +
      `tracking=${stack.env.TRACKING_ORIGIN} site=${stack.env.DEMO_SITE_URL} ` +
      `db=${stack.env.DB_PATH}`
  );

  try {
    if (interruptedSignal) {
      process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
      throw new Error(
        `E2E global setup が ${interruptedSignal} を受信しました`
      );
    }
    if (process.env.E2E_SUITE_FAIL_IMMEDIATELY === "1") {
      throw new Error("E2E_SUITE_FAIL_IMMEDIATELY による意図的な失敗");
    }

    // URL 定数を run 専用 env の設定後に評価するため、動的 import を使う。
    const [{ setupE2eFixtures, teardownE2eFixtures }, { TrackingClient }] =
      await Promise.all([
        import("../harness/session.js"),
        import("../tracking/client.js"),
      ]);
    const tracking = new TrackingClient();
    const fixtures = await setupE2eFixtures(tracking);
    process.env[FIXTURES_ENV] = JSON.stringify(fixtures);

    return async () => {
      const errors: unknown[] = [];
      try {
        await teardownE2eFixtures(tracking, fixtures);
      } catch (error) {
        errors.push(error);
      }
      try {
        await stack.stop();
        console.log(`[E2E stack] cleanup complete runId=${stack.runId}`);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "E2E global teardownに失敗しました");
      }
      await fs.rm(stackLogPath, { force: true });
    };
  } catch (setupError) {
    let stopError: unknown;
    try {
      await stack.stop();
      console.log(`[E2E stack] cleanup complete runId=${stack.runId}`);
    } catch (error) {
      stopError = error;
    }
    if (stopError) {
      throw new Error(
        `E2E global setupとstack cleanupに失敗しました: stack=${String(stopError)}`,
        { cause: setupError }
      );
    }
    if (interruptedSignal) {
      const signalExitCode = interruptedSignal === "SIGINT" ? 130 : 143;
      // Playwright CLI が setup 例外を1へ変換した後も従来のsignal終了コードを維持する。
      process.once("exit", () => {
        process.exitCode = signalExitCode;
      });
    }
    throw setupError;
  }
}
