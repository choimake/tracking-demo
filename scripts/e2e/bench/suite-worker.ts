// スタック env を継承した子プロセスで、指定ブラウザの E2E シナリオを直列実行する。
// 親プロセスのモジュールキャッシュを避けるため、エントリとして独立起動する。
import { chromium, firefox, webkit } from "playwright";

import type { BrowserName } from "../harness/config.js";
import {
  setupE2eFixtures,
  teardownE2eFixtures,
  createE2ePage,
} from "../harness/session.js";
import type { E2eContext } from "../harness/types.js";
import { e2eScenarios } from "../scenarios.js";
import { TrackingClient } from "../tracking/client.js";
import type { BrowserTiming, CaseTiming } from "./report.js";
import { elapsedMs, nowMs } from "./timing.js";

const BROWSERS: Record<
  BrowserName,
  typeof chromium | typeof firefox | typeof webkit
> = {
  chromium,
  firefox,
  webkit,
};

function parseBrowsers(argv: string[]): BrowserName[] {
  const idx = argv.indexOf("--browsers");
  if (idx < 0 || !argv[idx + 1]) {
    throw new Error("--browsers chromium[,firefox[,webkit]] が必要です");
  }
  const names = argv[idx + 1].split(",") as BrowserName[];
  for (const n of names) {
    if (!(n in BROWSERS)) {
      throw new Error(`未知のブラウザ: ${n}`);
    }
  }
  return names;
}

async function runBrowser(browserName: BrowserName): Promise<BrowserTiming> {
  const browserStart = nowMs();
  const tracking = new TrackingClient();
  const fixtures = await setupE2eFixtures(tracking);
  const cases: CaseTiming[] = [];
  let browserStatus: "pass" | "fail" = "pass";

  const browser = await BROWSERS[browserName].launch();
  try {
    const {
      page,
      trackerLogs,
      tracking: pageTracking,
    } = await createE2ePage(browser);
    const ctx: E2eContext = {
      browser,
      browserName,
      fixtures,
      trackerLogs,
      page,
      tracking: pageTracking,
    };

    for (const scenario of e2eScenarios) {
      const caseStart = nowMs();
      const name = `[${browserName}] ${scenario.name}`;
      process.stderr.write(`[BENCH] ${name}\n`);
      try {
        await scenario.run(ctx);
        cases.push({
          name: scenario.name,
          browser: browserName,
          case_ms: elapsedMs(caseStart),
          status: "pass",
        });
      } catch (error) {
        browserStatus = "fail";
        cases.push({
          name: scenario.name,
          browser: browserName,
          case_ms: elapsedMs(caseStart),
          status: "fail",
          error: (error as Error).message,
        });
        process.stderr.write(`  FAIL ${(error as Error).message}\n`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await teardownE2eFixtures(tracking, fixtures);
  }

  return {
    browser: browserName,
    browser_ms: elapsedMs(browserStart),
    status: browserStatus,
    cases,
  };
}

async function main(): Promise<void> {
  const browsers = parseBrowsers(process.argv.slice(2));
  const results: BrowserTiming[] = [];
  for (const browserName of browsers) {
    results.push(await runBrowser(browserName));
  }
  const status = results.every((b) => b.status === "pass") ? "pass" : "fail";
  // 親は stdout 最終行の JSON を読む
  process.stdout.write(`${JSON.stringify({ browsers: results, status })}\n`);
  process.exit(status === "pass" ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
