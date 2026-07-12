import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { test as base } from "@playwright/test";
import type {
  BrowserContext,
  BrowserContextOptions,
  ConsoleMessage,
  Page,
  Request,
  Response,
} from "playwright";

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

interface NetworkDiagnostic {
  context: number;
  method: string;
  page: number | null;
  resourceType: string;
  status?: number;
  url: string;
  failure?: string;
}

interface PageDiagnostic {
  consoleMessages: string[];
  errors: string[];
  index: number;
  screenshot?: Buffer;
}

interface ContextDiagnostic {
  context: BrowserContext;
  index: number;
  pages: Map<Page, PageDiagnostic>;
  tracePath: string;
  traceStopped: boolean;
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

function requestDiagnostic(
  request: Request,
  contextIndex: number,
  pageIndex: number | null
): NetworkDiagnostic {
  return {
    context: contextIndex,
    method: request.method(),
    page: pageIndex,
    resourceType: request.resourceType(),
    url: request.url(),
  };
}

class DiagnosticRegistry {
  readonly contexts: ContextDiagnostic[] = [];
  readonly network = new Map<Request, NetworkDiagnostic>();

  constructor(private readonly outputPath: (name: string) => string) {}

  async registerContext(context: BrowserContext): Promise<BrowserContext> {
    const state: ContextDiagnostic = {
      context,
      index: this.contexts.length,
      pages: new Map(),
      tracePath: this.outputPath(`context-${this.contexts.length}-trace.zip`),
      traceStopped: false,
    };
    this.contexts.push(state);
    context.on("page", (page) => this.registerPage(state, page));
    for (const page of context.pages()) this.registerPage(state, page);
    await context.tracing.start({ screenshots: true, snapshots: true });

    const originalClose = context.close.bind(context);
    context.close = async (options) => {
      await this.finalizeContext(state);
      await originalClose(options);
    };
    return context;
  }

  private registerPage(context: ContextDiagnostic, page: Page): void {
    if (context.pages.has(page)) return;
    const state: PageDiagnostic = {
      consoleMessages: [],
      errors: [],
      index: context.pages.size,
    };
    context.pages.set(page, state);
    page.on("console", (message: ConsoleMessage) => {
      state.consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      state.errors.push(error.stack ?? String(error));
    });
    page.on("request", (request) => {
      this.network.set(
        request,
        requestDiagnostic(request, context.index, state.index)
      );
    });
    page.on("response", (response: Response) => {
      const request = response.request();
      this.network.set(request, {
        ...requestDiagnostic(request, context.index, state.index),
        status: response.status(),
      });
    });
    page.on("requestfailed", (request) => {
      this.network.set(request, {
        ...requestDiagnostic(request, context.index, state.index),
        failure: request.failure()?.errorText ?? "unknown",
      });
    });

    const originalClose = page.close.bind(page);
    page.close = async (options) => {
      await this.captureScreenshot(page, state);
      await originalClose(options);
    };
  }

  private async captureScreenshot(
    page: Page,
    state: PageDiagnostic
  ): Promise<void> {
    if (state.screenshot || page.isClosed()) return;
    state.screenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => undefined);
  }

  async finalizeContext(state: ContextDiagnostic): Promise<void> {
    await Promise.all(
      [...state.pages].map(([page, pageState]) =>
        this.captureScreenshot(page, pageState)
      )
    );
    if (!state.traceStopped) {
      state.traceStopped = true;
      await state.context.tracing
        .stop({ path: state.tracePath })
        .catch(() => {});
    }
  }

  async finalizeAll(): Promise<void> {
    await Promise.all(
      this.contexts.map((state) => this.finalizeContext(state))
    );
  }

  async discardTraces(): Promise<void> {
    await Promise.all(
      this.contexts.map((state) => fs.rm(state.tracePath, { force: true }))
    );
  }
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
    const diagnostics = new DiagnosticRegistry((name) =>
      testInfo.outputPath(name)
    );
    const originalNewContext = browser.newContext;
    browser.newContext = async (
      options?: BrowserContextOptions
    ): Promise<BrowserContext> =>
      diagnostics.registerContext(
        await originalNewContext.call(browser, options)
      );
    const session = await createE2eSession(browser, {
      browserName: typedBrowserName,
      correlationId,
      mobile,
      recordVideoDir,
      userAgent: baseUserAgent,
    }).catch((error) => {
      browser.newContext = originalNewContext;
      throw error;
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
      browser.newContext = originalNewContext;
      const failed = testInfo.status !== testInfo.expectedStatus;
      await diagnostics.finalizeAll();
      if (failed) {
        const attachJson = (name: string, value: unknown) =>
          testInfo.attach(name, {
            body: Buffer.from(JSON.stringify(value, null, 2)),
            contentType: "application/json",
          });
        await Promise.all([
          attachJson("browser", {
            browserName: typedBrowserName,
            browserVersion: browser.version(),
            correlationId,
            userAgent: baseUserAgent,
          }),
          attachJson(
            "console",
            diagnostics.contexts.flatMap((contextState) =>
              [...contextState.pages.values()].map((pageState) => ({
                context: contextState.index,
                messages: pageState.consoleMessages,
                page: pageState.index,
              }))
            )
          ),
          attachJson(
            "page-errors",
            diagnostics.contexts.flatMap((contextState) =>
              [...contextState.pages.values()].map((pageState) => ({
                context: contextState.index,
                errors: pageState.errors,
                page: pageState.index,
              }))
            )
          ),
          attachJson("network", [...diagnostics.network.values()]),
          context.tracking
            .getHitsMatching({})
            .then((hits) => attachJson("correlated-hits", hits))
            .catch((error) =>
              attachJson("correlated-hits-error", String(error))
            ),
          ...diagnostics.contexts.flatMap((contextState) =>
            [...contextState.pages.values()].flatMap((pageState) =>
              pageState.screenshot
                ? [
                    testInfo.attach(
                      `screenshot-context-${contextState.index}-page-${pageState.index}`,
                      {
                        body: pageState.screenshot,
                        contentType: "image/png",
                      }
                    ),
                  ]
                : []
            )
          ),
        ]);
        const stackLogPath = process.env.E2E_STACK_LOG_PATH;
        if (stackLogPath) {
          await testInfo
            .attach("stack-log", {
              contentType: "text/plain",
              path: stackLogPath,
            })
            .catch(() => {});
        }
        await Promise.all(
          diagnostics.contexts.map((contextState) =>
            testInfo
              .attach(`trace-context-${contextState.index}`, {
                contentType: "application/zip",
                path: contextState.tracePath,
              })
              .catch(() => {})
          )
        );
      } else {
        await diagnostics.discardTraces();
      }
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
