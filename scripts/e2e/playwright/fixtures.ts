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
import { createManagedE2eRuntime } from "../harness/session.js";
import type { E2eContext, E2eFixtures } from "../harness/types.js";
import { e2eScenarios } from "../scenarios.js";
import { DIAGNOSTIC_CONTEXT_ANNOTATION } from "./failure-diagnostics.js";
import type { FailureDiagnosticContext } from "./failure-diagnostics.js";
import {
  attachFailureDiagnostics,
  runScenarioFixtureLifecycle,
} from "./teardown.js";

interface E2eTestFixtures {
  e2eContext: E2eContext;
}

interface E2eWorkerFixtures {
  baseUserAgent: string;
}

const scenarioNames = e2eScenarios.map((scenario) => scenario.name);
const duplicateScenarioNames = scenarioNames.filter(
  (name, index) => scenarioNames.indexOf(name) !== index
);
if (duplicateScenarioNames.length > 0) {
  throw new Error(
    `シナリオ名が重複しています: ${[...new Set(duplicateScenarioNames)].join(", ")}`
  );
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
    { auto: true, scope: "worker" },
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
    const correlationId = `${runId}/${typedBrowserName}/repeat-${testInfo.repeatEachIndex}/${scenarioIndex}-${scenarioHash}`;
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
    const scenario = e2eScenarios[scenarioIndex];
    if (scenario === undefined) {
      throw new Error(`シナリオ登録が見つかりません: ${testInfo.title}`);
    }
    const runtime = await createManagedE2eRuntime({
      browserName: typedBrowserName,
      correlationId,
      contextFactory: (options) => browser.newContext(options),
      mobile,
      ...(recordVideoDir === undefined ? {} : { recordVideoDir }),
      ...(recordVideoMode === null ? {} : { recordVideoMode }),
      ...(scenarioVideoPath === undefined ? {} : { scenarioVideoPath }),
      userAgent: baseUserAgent,
    });
    const context: E2eContext = {
      advanceClockBy: runtime.session.advanceClockBy,
      browserName: typedBrowserName,
      clearCookies: runtime.session.clearCookies,
      cookies: runtime.session.cookies,
      correlationId,
      fixtures,
      installClock: runtime.session.installClock,
      mobile,
      newPage: runtime.session.newPage,
      page: runtime.session.page,
      repeat: testInfo.repeatEachIndex,
      route: runtime.session.route,
      scenarioId: scenario.id,
      seed: process.env.E2E_SEED ? Number(process.env.E2E_SEED) : null,
      trackerLogs: runtime.trackerLogs,
      tracking: runtime.tracking,
      unroute: runtime.session.unroute,
      userAgent: baseUserAgent,
      withSession: (options, callback) =>
        runtime.withSession(options, callback),
    };

    try {
      await use(context);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus;
      const stackLogPath = process.env.E2E_STACK_LOG_PATH;
      const diagnosticContext: FailureDiagnosticContext = {
        browser: typedBrowserName,
        correlationId,
        hitCursor: runtime.tracking.getDiagnosticHitCursor(),
        manifestPath: testInfo.outputPath("failure-diagnostics-manifest.json"),
        repeat: testInfo.repeatEachIndex,
        scenarioId: scenario.id,
        scenarioName: testInfo.title,
        seed: process.env.E2E_SEED ? Number(process.env.E2E_SEED) : null,
        video:
          recordVideoMode && scenarioVideoPath
            ? { mode: recordVideoMode, path: scenarioVideoPath }
            : null,
      };
      testInfo.annotations.push({
        description: JSON.stringify(diagnosticContext),
        type: DIAGNOSTIC_CONTEXT_ANNOTATION,
      });
      const failureDiagnostics = () =>
        attachFailureDiagnostics({
          attachJson: (name, value) =>
            testInfo.attach(name, {
              body: Buffer.from(JSON.stringify(value, null, 2)),
              contentType: "application/json",
            }),
          ...(stackLogPath
            ? {
                attachStackLog: () =>
                  testInfo.attach("stack-log", {
                    contentType: "text/plain",
                    path: stackLogPath,
                  }),
              }
            : {}),
          getConsoleLog: async () => runtime.diagnostics().console,
          getCorrelatedHits: () => context.tracking.getHitsMatching({}),
          getPageErrors: async () => runtime.diagnostics().pageErrors,
        });
      await runScenarioFixtureLifecycle({
        ...(recordVideoMode
          ? { cleanupVideo: (ok) => runtime.finalizeVideo(ok) }
          : {}),
        closeBrowserContext: () => runtime.close(),
        failureDiagnostics,
        scenarioFailed: failed,
      });
    }
  },
});
