import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TestCase, TestResult } from "@playwright/test/reporter";

import {
  formatAssertionFailure,
  runWithAssertionContext,
} from "../tracking/assertion-formatter.js";
import FailureDiagnosticsReporter, {
  resolveDiagnosticContext,
} from "./failure-diagnostics-reporter.js";
import {
  validateFailureDiagnosticManifest,
  writeFailureDiagnosticManifest,
} from "./failure-diagnostics.js";
import type {
  DiagnosticAttachment,
  FailureDiagnosticContext,
  ManifestOperations,
} from "./failure-diagnostics.js";

const ARTIFACT_NAMES = [
  "hit",
  "trace",
  "screenshot",
  "stackLog",
  "console",
  "pageError",
  "video",
] as const;

async function fixture(directory: string): Promise<{
  attachments: DiagnosticAttachment[];
  context: FailureDiagnosticContext;
}> {
  await fs.mkdir(directory, { recursive: true });
  const tracePath = path.join(directory, "trace.zip");
  const screenshotPath = path.join(directory, "test-failed-1.png");
  const stackPath = path.join(directory, "stack.log");
  const videoPath = path.join(directory, "scenario.webm");
  await Promise.all([
    fs.writeFile(tracePath, "trace"),
    fs.writeFile(screenshotPath, "screenshot"),
    fs.writeFile(stackPath, "stack"),
    fs.writeFile(videoPath, "video"),
  ]);
  return {
    attachments: [
      {
        body: Buffer.from("[]"),
        contentType: "application/json",
        name: "correlated-hits",
      },
      {
        body: Buffer.from("[]"),
        contentType: "application/json",
        name: "console-log",
      },
      {
        body: Buffer.from("[]"),
        contentType: "application/json",
        name: "page-errors",
      },
      { contentType: "application/zip", name: "trace", path: tracePath },
      {
        contentType: "image/png",
        name: "screenshot",
        path: screenshotPath,
      },
      { contentType: "text/plain", name: "stack-log", path: stackPath },
    ],
    context: {
      browser: "chromium",
      correlationId: "run/chromium/repeat-0/scenario-1",
      hitCursor: { captured: true, value: "hit-42" },
      manifestPath: path.join(directory, "failure-diagnostics-manifest.json"),
      repeat: 0,
      scenarioId: "scenario-1",
      scenarioName: "manifest回帰",
      seed: 20260714,
      video: { mode: "on-failure", path: videoPath },
    },
  };
}

async function structuredError(): Promise<Error> {
  return runWithAssertionContext(
    {
      browser: "chromium",
      correlationId: "run/chromium/repeat-0/scenario-1",
      repeat: 0,
      scenarioId: "scenario-1",
      seed: 20260714,
    },
    async () =>
      new Error(
        formatAssertionFailure({
          actual: { count: 2 },
          context: { label: "1件期待" },
          expected: { count: 1 },
          name: "hit-count-exactly",
          summary: "Hit 件数が不一致: got=2 want=1",
        })
      )
  );
}

async function checkCompleteManifest(directory: string): Promise<void> {
  const input = await fixture(directory);
  const assertionFailure = await structuredError();
  const manifest = await writeFailureDiagnosticManifest({
    ...input,
    errors: [
      { message: assertionFailure.message, stack: assertionFailure.stack },
    ],
    now: () => new Date("2026-07-14T00:00:00.000Z"),
  });
  validateFailureDiagnosticManifest(manifest);
  assert.deepEqual(
    Object.keys(manifest.artifacts).toSorted(),
    [...ARTIFACT_NAMES].toSorted()
  );
  assert.equal(manifest.scenario.id, "scenario-1");
  assert.equal(manifest.scenario.hitCursor.value, "hit-42");
  assert.equal(manifest.failure.assertion.status, "available");
  assert.deepEqual(manifest.failure.finalObserved, { count: 2 });
  assert.equal(
    manifest.failure.assertion.status === "available"
      ? manifest.failure.assertion.context.seed
      : undefined,
    20260714
  );
  assert.throws(
    () =>
      validateFailureDiagnosticManifest({
        ...manifest,
        scenario: { ...manifest.scenario, seed: undefined },
      } as unknown as typeof manifest),
    /seed/,
    "seed欠落を拒否する"
  );
  const { console: _missingConsole, ...missingConsoleArtifacts } =
    manifest.artifacts;
  assert.throws(
    () =>
      validateFailureDiagnosticManifest({
        ...manifest,
        artifacts: missingConsoleArtifacts,
      } as unknown as typeof manifest),
    /artifact必須field/,
    "artifact欠落を拒否する"
  );
  if (manifest.failure.assertion.status === "available") {
    const { actual: _missingActual, ...missingActual } =
      manifest.failure.assertion;
    assert.throws(
      () =>
        validateFailureDiagnosticManifest({
          ...manifest,
          failure: { ...manifest.failure, assertion: missingActual },
        } as unknown as typeof manifest),
      /構造化assertion/,
      "actual欠落を拒否する"
    );
  }
  await fs.access(input.context.manifestPath);
}

async function checkArtifactFailureTolerance(directory: string): Promise<void> {
  const input = await fixture(directory);
  const operations: ManifestOperations = {
    access: async (filePath) => {
      if (filePath === input.context.video?.path) {
        throw new Error("injected failure: video access");
      }
      await fs.access(filePath);
    },
    mkdir: async (target) => {
      await fs.mkdir(target, { recursive: true });
    },
    writeFile: async (filePath, value) => {
      if (filePath.endsWith("console.json")) {
        throw new Error("injected failure: console write");
      }
      await fs.writeFile(filePath, value);
    },
  };
  const manifest = await writeFailureDiagnosticManifest({
    ...input,
    errors: [{ message: "意図的なシナリオ失敗" }],
    operations,
  });
  assert.equal(manifest.artifacts.console.status, "unavailable");
  assert.match(
    manifest.artifacts.console.generationError ?? "",
    /injected failure/
  );
  assert.equal(manifest.artifacts.video.status, "unavailable");
  assert.match(
    manifest.artifacts.video.generationError ?? "",
    /injected failure/
  );
  await fs.access(input.context.manifestPath);
}

async function checkSchemaRequiredFields(): Promise<void> {
  const schema = JSON.parse(
    await fs.readFile(
      new URL("./failure-diagnostics.schema.json", import.meta.url),
      "utf8"
    )
  ) as {
    properties: {
      artifacts: { required: string[] };
      failure: { required: string[] };
      scenario: { required: string[] };
    };
    required: string[];
  };
  assert.deepEqual(schema.required, [
    "schemaVersion",
    "generatedAt",
    "scenario",
    "failure",
    "artifacts",
  ]);
  assert.deepEqual(
    schema.properties.artifacts.required.toSorted(),
    [...ARTIFACT_NAMES].toSorted()
  );
  assert.deepEqual(schema.properties.failure.required, [
    "errors",
    "assertion",
    "finalObserved",
  ]);
  assert.deepEqual(schema.properties.scenario.required, [
    "id",
    "name",
    "browser",
    "repeat",
    "seed",
    "correlationId",
    "hitCursor",
  ]);
}

function reporterTest(
  context: FailureDiagnosticContext | undefined,
  title = "manifest回帰"
): TestCase {
  return {
    annotations: context
      ? [
          {
            description: JSON.stringify(context),
            type: "e2e-diagnostic-context",
          },
        ]
      : [],
    expectedStatus: "passed",
    id: "reporter-contract",
    parent: { project: () => ({ name: "chromium" }) },
    repeatEachIndex: 0,
    title,
  } as unknown as TestCase;
}

async function checkReporterContract(directory: string): Promise<void> {
  const input = await fixture(directory);
  const reporter = new FailureDiagnosticsReporter();
  const assertionFailure = await structuredError();
  const failedContext = {
    ...input.context,
    manifestPath: path.join(directory, "reporter-failure-manifest.json"),
  };
  await reporter.onTestEnd(reporterTest(failedContext), {
    attachments: input.attachments,
    errors: [
      { message: assertionFailure.message, stack: assertionFailure.stack },
    ],
    status: "failed",
  } as unknown as TestResult);
  await fs.access(failedContext.manifestPath);

  const successContext = {
    ...input.context,
    manifestPath: path.join(directory, "reporter-success-manifest.json"),
  };
  await reporter.onTestEnd(reporterTest(successContext), {
    attachments: [],
    errors: [],
    status: "passed",
  } as unknown as TestResult);
  await assert.rejects(
    fs.access(successContext.manifestPath),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    "成功時はmanifestを出力しない"
  );

  const fallback = resolveDiagnosticContext(reporterTest(undefined));
  assert.equal(fallback.browser, "chromium");
  assert.equal(fallback.hitCursor.captured, false);
  assert.ok(fallback.correlationId.includes("/chromium/repeat-0/"));
}

const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "failure-diagnostics-regression-")
);
try {
  await checkCompleteManifest(path.join(directory, "complete"));
  await checkArtifactFailureTolerance(path.join(directory, "partial"));
  await checkSchemaRequiredFields();
  await checkReporterContract(path.join(directory, "reporter"));
  console.log("failure diagnostics manifest regression: PASS");
} finally {
  await fs.rm(directory, { force: true, recursive: true });
}
