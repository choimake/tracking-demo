import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { test as base } from "@playwright/test";

import type { BrowserName } from "../harness/config.js";
import {
  e2eVideoDir,
  isE2eMobile,
  parseRecordVideoMode,
  toScenarioSlug,
} from "../harness/config.js";
import { createE2eSession } from "../harness/session.js";
import type { E2eContext, E2eFixtures } from "../harness/types.js";
import { finalizeScenarioVideo } from "../harness/video.js";
import { e2eScenarios } from "../scenarios.js";

interface E2eTestFixtures {
  e2eContext: E2eContext;
}

interface E2eWorkerFixtures {
  baseUserAgent: string;
}

function asBrowserName(value: string): BrowserName {
  if (value === "chromium" || value === "firefox" || value === "webkit") {
    return value;
  }
  throw new Error(`未知の browserName: ${value}`);
}

function parseGlobalFixtures(raw: string | undefined): E2eFixtures {
  if (!raw) {
    throw new Error("E2E_FIXTURES がありません");
  }
  const fixtures = JSON.parse(raw) as Partial<E2eFixtures>;
  if (
    typeof fixtures.exitIntentEventId !== "string" ||
    typeof fixtures.timeOnPageEventId !== "string" ||
    typeof fixtures.japaneseUrlEventId !== "string"
  ) {
    throw new Error("E2E_FIXTURES の形式が不正です");
  }
  return fixtures as E2eFixtures;
}

async function finalizeOrDiscardVideo(options: {
  mode: "all" | "on-failure";
  ok: boolean;
  page: E2eContext["page"];
  videoPath: string;
}): Promise<void> {
  const alreadyPromoted = await fs
    .access(options.videoPath)
    .then(() => true)
    .catch(() => false);
  if (!alreadyPromoted) {
    await finalizeScenarioVideo(options);
    return;
  }

  const outerVideo = options.page.video();
  if (outerVideo) {
    const outerPath = await outerVideo.path().catch(() => null);
    if (outerPath && outerPath !== options.videoPath) {
      await fs.unlink(outerPath).catch(() => {});
    }
  }
  if (options.mode === "on-failure" && options.ok) {
    await fs.unlink(options.videoPath).catch(() => {});
  } else if (!options.ok) {
    console.error(`  video: ${path.resolve(options.videoPath)}`);
  }
}

export const test = base.extend<E2eTestFixtures, E2eWorkerFixtures>({
  baseUserAgent: [
    async ({ browser }, use) => {
      const probePage = await browser.newPage();
      try {
        await use(await probePage.evaluate(() => navigator.userAgent));
      } finally {
        await probePage.context().close();
      }
    },
    { scope: "worker" },
  ],
  e2eContext: async (
    { baseUserAgent, browser, browserName },
    use,
    testInfo
  ) => {
    const typedBrowserName = asBrowserName(browserName);
    const scenarioIndex = e2eScenarios.findIndex(
      (scenario) => scenario.name === testInfo.title
    );
    if (scenarioIndex < 0) {
      throw new Error(`シナリオ登録が見つかりません: ${testInfo.title}`);
    }
    const runId = process.env.E2E_RUN_ID;
    if (!runId) {
      throw new Error("E2E_RUN_ID がありません");
    }
    const scenarioHash = crypto
      .createHash("sha256")
      .update(testInfo.title)
      .digest("hex")
      .slice(0, 12);
    const correlationId = `${runId}/${typedBrowserName}/${scenarioIndex}-${scenarioHash}`;
    const mobile = isE2eMobile();
    const recordVideoMode = parseRecordVideoMode();
    const recordVideoDir = recordVideoMode
      ? e2eVideoDir(typedBrowserName)
      : undefined;
    const scenarioVideoPath = recordVideoDir
      ? path.join(recordVideoDir, `${toScenarioSlug(testInfo.title)}.webm`)
      : undefined;
    if (recordVideoDir) {
      await fs.mkdir(recordVideoDir, { recursive: true });
    }
    const fixtures = parseGlobalFixtures(process.env.E2E_FIXTURES);
    const session = await createE2eSession(browser, {
      browserName: typedBrowserName,
      correlationId,
      mobile,
      recordVideoDir,
      userAgent: baseUserAgent,
    });
    const context: E2eContext = {
      browser,
      browserName: typedBrowserName,
      correlationId,
      fixtures,
      mobile,
      page: session.page,
      recordVideoDir,
      scenarioVideoPath,
      trackerLogs: session.trackerLogs,
      tracking: session.tracking,
      userAgent: baseUserAgent,
    };

    try {
      await use(context);
    } finally {
      await session.context.close().catch((error) => {
        console.error(`  context.close failed: ${String(error)}`);
      });
      if (recordVideoMode && scenarioVideoPath) {
        await finalizeOrDiscardVideo({
          mode: recordVideoMode,
          ok: testInfo.status === testInfo.expectedStatus,
          page: session.page,
          videoPath: scenarioVideoPath,
        });
      }
    }
  },
});
