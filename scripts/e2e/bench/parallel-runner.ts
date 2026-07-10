import type { BrowserName } from "../harness/config.js";
import type { BrowserTiming } from "./report.js";
import { runSuiteWorker } from "./serial-runner.js";
import { startStack } from "./stack.js";
import { elapsedMs, nowMs } from "./timing.js";

export interface ParallelRunOptions {
  runId: string;
  browsers: BrowserName[];
  iteration: number;
  warmup: boolean;
}

/**
 * ブラウザ数分の独立スタック+ワーカーを並列起動する。
 * 同一 db.json 上の Promise.all は使わない(プロセス隔離のみ)。
 */
export async function runParallelIteration(opts: ParallelRunOptions): Promise<{
  iteration: number;
  warmup: boolean;
  suite_wall_ms: number;
  status: "pass" | "fail";
  browsers: BrowserTiming[];
}> {
  const wallStart = nowMs();

  const workerResults = await Promise.all(
    opts.browsers.map(async (browser, workerIndex) => {
      const stack = await startStack({
        runId: opts.runId,
        workerIndex,
        dbLabel: browser,
      });
      try {
        const result = await runSuiteWorker([browser], stack.env);
        return result.browsers[0];
      } finally {
        await stack.stop();
      }
    })
  );

  const browsers = workerResults.filter((b): b is BrowserTiming => Boolean(b));
  const status = browsers.every((b) => b.status === "pass") ? "pass" : "fail";

  return {
    iteration: opts.iteration,
    warmup: opts.warmup,
    suite_wall_ms: elapsedMs(wallStart),
    status,
    browsers,
  };
}
