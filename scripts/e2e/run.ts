// tracker.js(計測スクリプト)の実ブラウザ検証のエントリ。
// 実行: npm run e2e (npm start で両サーバーが起動していること)
// Chromium / Firefox / WebKit を直列実行する(共有 db.json のため並列禁止)
import { chromium, firefox, webkit } from "playwright";

import type { BrowserName } from "./harness/config.js";
import { E2eRunner } from "./harness/runner.js";
import {
  setupE2eFixtures,
  teardownE2eFixtures,
  createE2ePage,
} from "./harness/session.js";
import type { E2eContext } from "./harness/types.js";
import { e2eScenarios } from "./scenarios.js";
import { TrackingClient } from "./tracking/client.js";

const BROWSERS: Record<
  BrowserName,
  typeof chromium | typeof firefox | typeof webkit
> = {
  chromium,
  firefox,
  webkit,
};

const BROWSER_ORDER: BrowserName[] = ["chromium", "firefox", "webkit"];

async function main(): Promise<void> {
  const tracking = new TrackingClient();
  const fixtures = await setupE2eFixtures(tracking);
  const runner = new E2eRunner();

  try {
    for (const browserName of BROWSER_ORDER) {
      console.log(`\n===== browser: ${browserName} =====`);
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
          await runner.runE2eCase(`[${browserName}] ${scenario.name}`, () =>
            scenario.run(ctx)
          );
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    await teardownE2eFixtures(tracking, fixtures);
  }

  runner.printSummary();
  process.exit(runner.exitCode);
}

main();
