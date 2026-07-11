// tracker.js(計測スクリプト)の実ブラウザ検証のエントリ。
// 実行: npm run e2e (npm start で両サーバーが起動していること)
// Chromium / Firefox / WebKit を直列実行する(共有 db.json のため並列禁止)
import fs from "node:fs/promises";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";
import { chromium, firefox, webkit } from "playwright";

import type { BrowserName, RecordVideoMode } from "./harness/config.js";
import {
  e2eVideoDir,
  isE2eMobile,
  parseE2eBrowsers,
  parseRecordVideoMode,
  toScenarioSlug,
} from "./harness/config.js";
import { E2eRunner } from "./harness/runner.js";
import {
  setupE2eFixtures,
  teardownE2eFixtures,
  createE2eSession,
} from "./harness/session.js";
import type { E2eContext, E2eFixtures } from "./harness/types.js";
import { finalizeScenarioVideo } from "./harness/video.js";
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

/** 内側が scenarioVideoPath を確定済みなら外側の空録画を捨て、未確定なら finalize する */
async function finalizeOrDiscardScenarioVideo(options: {
  mode: RecordVideoMode;
  ok: boolean;
  page: Page;
  videoPath: string;
}): Promise<void> {
  const { mode, ok, page, videoPath } = options;
  const alreadyPromoted = await fs
    .access(videoPath)
    .then(() => true)
    .catch(() => false);
  if (!alreadyPromoted) {
    await finalizeScenarioVideo({ mode, ok, page, videoPath });
    return;
  }

  // 内側が scenarioVideoPath を確定済み。外側の空録画だけ捨てる
  const outerVideo = page.video();
  if (outerVideo) {
    const outerPath = await outerVideo.path().catch(() => null);
    if (outerPath && outerPath !== videoPath) {
      await fs.unlink(outerPath).catch(() => {});
    }
  }
  if (mode === "on-failure" && ok) {
    await fs.unlink(videoPath).catch(() => {});
  } else if (!ok) {
    console.error(`  video: ${path.resolve(videoPath)}`);
  }
}

async function closeSessionContext(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch (error) {
    console.error(`  context.close failed: ${String(error)}`);
  }
}

/** 録画時: シナリオごとに context を開閉する(close 時に webm が確定するため) */
async function runBrowserScenariosWithVideo(options: {
  browser: Browser;
  browserName: BrowserName;
  deviceLabel: string;
  fixtures: E2eFixtures;
  mobile: boolean;
  mode: RecordVideoMode;
  runner: E2eRunner;
}): Promise<void> {
  const { browser, browserName, deviceLabel, fixtures, mobile, mode, runner } =
    options;
  const videoDir = e2eVideoDir(browserName);
  await fs.mkdir(videoDir, { recursive: true });

  for (const scenario of e2eScenarios) {
    const videoPath = path.join(
      videoDir,
      `${toScenarioSlug(scenario.name)}.webm`
    );
    const session = await createE2eSession(browser, {
      browserName,
      mobile,
      recordVideoDir: videoDir,
    });
    const ctx: E2eContext = {
      browser,
      browserName,
      fixtures,
      mobile,
      page: session.page,
      recordVideoDir: videoDir,
      scenarioVideoPath: videoPath,
      trackerLogs: session.trackerLogs,
      tracking: session.tracking,
    };

    // run 前は false 相当。想定外例外でも context を閉じる
    let ok = false;
    try {
      ok = await runner.runE2eCase(`[${deviceLabel}] ${scenario.name}`, () =>
        scenario.run(ctx)
      );
    } finally {
      await closeSessionContext(session.context);
      await finalizeOrDiscardScenarioVideo({
        mode,
        ok,
        page: session.page,
        videoPath,
      });
    }
  }
}

/** フラグなし: 速度優先でブラウザごとに page を共有 */
async function runBrowserScenariosShared(options: {
  browser: Browser;
  browserName: BrowserName;
  deviceLabel: string;
  fixtures: E2eFixtures;
  mobile: boolean;
  runner: E2eRunner;
}): Promise<void> {
  const { browser, browserName, deviceLabel, fixtures, mobile, runner } =
    options;
  const session = await createE2eSession(browser, {
    browserName,
    mobile,
  });
  const ctx: E2eContext = {
    browser,
    browserName,
    fixtures,
    mobile,
    page: session.page,
    trackerLogs: session.trackerLogs,
    tracking: session.tracking,
  };

  try {
    for (const scenario of e2eScenarios) {
      await runner.runE2eCase(`[${deviceLabel}] ${scenario.name}`, () =>
        scenario.run(ctx)
      );
    }
  } finally {
    await closeSessionContext(session.context);
  }
}

async function main(): Promise<void> {
  const tracking = new TrackingClient();
  const fixtures = await setupE2eFixtures(tracking);
  const runner = new E2eRunner();
  const recordVideoMode = parseRecordVideoMode();
  const mobile = isE2eMobile();
  const browserOrder = parseE2eBrowsers();

  try {
    for (const browserName of browserOrder) {
      const deviceLabel = mobile ? `${browserName}:mobile` : browserName;
      console.log(`\n===== browser: ${deviceLabel} =====`);
      const browser = await BROWSERS[browserName].launch();
      try {
        if (recordVideoMode) {
          await runBrowserScenariosWithVideo({
            browser,
            browserName,
            deviceLabel,
            fixtures,
            mobile,
            mode: recordVideoMode,
            runner,
          });
        } else {
          await runBrowserScenariosShared({
            browser,
            browserName,
            deviceLabel,
            fixtures,
            mobile,
            runner,
          });
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
