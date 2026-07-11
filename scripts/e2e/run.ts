import crypto from "node:crypto";
// launch.ts が起動した run 専用スタックに対して実ブラウザ検証を行う子プロセス。
// Chromium / Firefox / WebKit を直列実行する。
// シナリオごとに BrowserContext を開閉し、Cookie 等のブラウザ状態を隔離する
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

export type E2eSuiteEntry = string;

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

/**
 * シナリオ間の Cookie 等隔離のため、常にシナリオごとに context を開閉する。
 * 録画あり時のみ recordVideoDir を渡し、close 後に video を finalize する。
 */
async function runBrowserScenarios(options: {
  browser: Browser;
  browserName: BrowserName;
  deviceLabel: string;
  fixtures: E2eFixtures;
  mobile: boolean;
  recordVideoMode: RecordVideoMode | null;
  runner: E2eRunner;
}): Promise<void> {
  const {
    browser,
    browserName,
    deviceLabel,
    fixtures,
    mobile,
    recordVideoMode,
    runner,
  } = options;
  const videoDir = recordVideoMode ? e2eVideoDir(browserName) : undefined;
  if (videoDir) {
    await fs.mkdir(videoDir, { recursive: true });
  }

  const probePage = await browser.newPage();
  const userAgent = await probePage.evaluate(() => navigator.userAgent);
  await probePage.context().close();
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error("E2E_RUN_ID がありません");
  }

  for (const [scenarioIndex, scenario] of e2eScenarios.entries()) {
    const scenarioHash = crypto
      .createHash("sha256")
      .update(scenario.name)
      .digest("hex")
      .slice(0, 12);
    const correlationId = `${runId}/${browserName}/${scenarioIndex}-${scenarioHash}`;
    const videoPath = videoDir
      ? path.join(videoDir, `${toScenarioSlug(scenario.name)}.webm`)
      : undefined;
    const session = await createE2eSession(browser, {
      browserName,
      correlationId,
      mobile,
      recordVideoDir: videoDir,
      userAgent,
    });
    const ctx: E2eContext = {
      browser,
      browserName,
      correlationId,
      fixtures,
      mobile,
      page: session.page,
      recordVideoDir: videoDir,
      scenarioVideoPath: videoPath,
      trackerLogs: session.trackerLogs,
      tracking: session.tracking,
      userAgent,
    };

    // run 前は false 相当。想定外例外でも context を閉じる
    let ok = false;
    try {
      ok = await runner.runE2eCase(`[${deviceLabel}] ${scenario.name}`, () =>
        scenario.run(ctx)
      );
    } finally {
      await closeSessionContext(session.context);
      if (recordVideoMode && videoPath) {
        await finalizeOrDiscardScenarioVideo({
          mode: recordVideoMode,
          ok,
          page: session.page,
          videoPath,
        });
      }
    }
  }
}

async function main(): Promise<void> {
  if (process.env.E2E_SUITE_FAIL_IMMEDIATELY === "1") {
    throw new Error("E2E_SUITE_FAIL_IMMEDIATELY による意図的な失敗");
  }
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
        await runBrowserScenarios({
          browser,
          browserName,
          deviceLabel,
          fixtures,
          mobile,
          recordVideoMode,
          runner,
        });
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

if (process.env.E2E_SUITE_CHILD === "1") {
  main();
}
