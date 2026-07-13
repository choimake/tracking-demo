import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Page } from "playwright";

import {
  finalizeOrDiscardVideo,
  finalizeScenarioVideo,
} from "../harness/video.js";
import {
  attachFailureDiagnostics,
  runScenarioFixtureLifecycle,
  runScenarioFixtureTeardown,
} from "./teardown.js";

const STAGE_NAMES = [
  "失敗時の診断artifact",
  "BrowserContextのclose",
  "video cleanup",
] as const;

function injectedFixtureTeardown(failures: ReadonlySet<string>): {
  attempts: string[];
  run: () => Promise<void>;
} {
  const attempts: string[] = [];
  const stage = (name: string) => async (): Promise<void> => {
    attempts.push(name);
    if (failures.has(name)) {
      throw new Error(`injected failure: ${name}`);
    }
  };
  return {
    attempts,
    run: () =>
      runScenarioFixtureTeardown({
        cleanupVideo: stage("video cleanup"),
        closeBrowserContext: stage("BrowserContextのclose"),
        failureDiagnostics: stage("失敗時の診断artifact"),
      }),
  };
}

async function checkSuccessfulOrder(): Promise<void> {
  const { attempts, run } = injectedFixtureTeardown(new Set());
  await run();
  assert.deepEqual(attempts, STAGE_NAMES);
  console.log("scenario teardown success: all stages ran in order");
}

async function checkEachStageFailure(): Promise<void> {
  for (const failedStage of STAGE_NAMES) {
    const { attempts, run } = injectedFixtureTeardown(new Set([failedStage]));
    await assert.rejects(run(), (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 1);
      assert.match(error.message, new RegExp(failedStage));
      assert.match(
        error.message,
        new RegExp(`injected failure: ${failedStage}`)
      );
      return true;
    });
    assert.deepEqual(attempts, STAGE_NAMES);
  }
  console.log("scenario teardown single failure: later stages still ran");
}

async function checkMultipleFailures(): Promise<void> {
  const { attempts, run } = injectedFixtureTeardown(
    new Set<string>(STAGE_NAMES)
  );
  await assert.rejects(run(), (error: unknown) => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors.length, STAGE_NAMES.length);
    for (const [index, stageName] of STAGE_NAMES.entries()) {
      const stageError = error.errors[index];
      assert(stageError instanceof Error);
      assert.match(stageError.message, new RegExp(stageName));
      assert.match(error.message, new RegExp(`injected failure: ${stageName}`));
      assert(stageError.cause instanceof Error);
      assert.match(stageError.cause.message, /injected failure/);
    }
    return true;
  });
  assert.deepEqual(attempts, STAGE_NAMES);
  console.log(
    "scenario teardown multiple failures: all causes retained and propagated"
  );
}

async function checkFailureDiagnostics(): Promise<void> {
  const attempts: string[] = [];
  await assert.rejects(
    attachFailureDiagnostics({
      attachJson: async (name) => {
        attempts.push(name);
        if (name === "correlated-hits-error") {
          throw new Error("injected failure: correlated-hits-error attach");
        }
      },
      attachStackLog: async () => {
        attempts.push("stack-log");
        throw new Error("injected failure: stack-log attach");
      },
      getConsoleLog: async () => {
        attempts.push("get-console-log");
        return [];
      },
      getCorrelatedHits: async () => {
        attempts.push("get-correlated-hits");
        throw new Error("injected failure: get-correlated-hits");
      },
      getPageErrors: async () => {
        attempts.push("get-page-errors");
        return [];
      },
    }),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.message, /injected failure: get-correlated-hits/);
      assert.match(
        error.message,
        /injected failure: correlated-hits-error attach/
      );
      assert.match(error.message, /injected failure: stack-log attach/);
      return true;
    }
  );
  assert.deepEqual(attempts, [
    "get-correlated-hits",
    "correlated-hits-error",
    "get-console-log",
    "console-log",
    "get-page-errors",
    "page-errors",
    "stack-log",
    "stack-log-error",
  ]);
  console.log(
    "failure diagnostics: correlated-hits and stack-log failures retained"
  );
}

async function checkDiagnosticReasonAttachments(): Promise<void> {
  const attached: string[] = [];
  await assert.rejects(
    attachFailureDiagnostics({
      attachJson: async (name) => {
        attached.push(name);
      },
      getConsoleLog: async () => {
        throw new Error("injected failure: console collection");
      },
      getCorrelatedHits: async () => [],
      getPageErrors: async () => {
        throw new Error("injected failure: page error collection");
      },
    }),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.message, /console collection/);
      assert.match(error.message, /page error collection/);
      return true;
    }
  );
  assert.deepEqual(attached, [
    "correlated-hits",
    "console-log-error",
    "page-errors-error",
  ]);
  console.log("failure diagnostics: artifact failure reasons attached");
}

async function checkOptionalStages(): Promise<void> {
  const attempts: string[] = [];
  await runScenarioFixtureTeardown({
    cleanupVideo: async () => {
      attempts.push("video cleanup");
    },
    closeBrowserContext: async () => {
      attempts.push("BrowserContextのclose");
    },
  });
  assert.deepEqual(attempts, ["BrowserContextのclose", "video cleanup"]);

  attempts.length = 0;
  await runScenarioFixtureTeardown({
    closeBrowserContext: async () => {
      attempts.push("BrowserContextのclose");
    },
  });
  assert.deepEqual(attempts, ["BrowserContextのclose"]);
  console.log(
    "scenario teardown optional stages: diagnostics and video skipped"
  );
}

async function checkTeardownFailureDiagnostics(): Promise<void> {
  const attempts: string[] = [];
  await assert.rejects(
    runScenarioFixtureLifecycle({
      cleanupVideo: async (ok) => {
        attempts.push(`video:${ok}`);
      },
      closeBrowserContext: async () => {
        attempts.push("close");
        throw new Error("injected failure: close");
      },
      failureDiagnostics: async () => {
        attempts.push("diagnostics");
      },
      scenarioFailed: false,
    }),
    /injected failure: close/
  );
  assert.deepEqual(attempts, ["close", "video:false", "diagnostics"]);

  attempts.length = 0;
  await runScenarioFixtureLifecycle({
    cleanupVideo: async (ok) => {
      attempts.push(`video:${ok}`);
    },
    closeBrowserContext: async () => {
      attempts.push("close");
    },
    failureDiagnostics: async () => {
      attempts.push("diagnostics");
    },
    scenarioFailed: true,
  });
  assert.deepEqual(attempts, ["diagnostics", "close", "video:false"]);
  console.log("teardown failure diagnostics: late failure retains artifacts");
}

function fakePage(videoPath: () => Promise<string>): Page {
  return {
    video: () => ({ path: videoPath }),
  } as unknown as Page;
}

async function assertMissing(filePath: string): Promise<void> {
  await assert.rejects(
    fs.access(filePath),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT"
  );
}

async function checkVideoArtifactContract(): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "scenario-teardown-video-")
  );
  try {
    const allOriginal = path.join(directory, "all-original.webm");
    const allFinal = path.join(directory, "all-final.webm");
    await fs.writeFile(allOriginal, "all");
    await finalizeScenarioVideo({
      mode: "all",
      ok: true,
      page: fakePage(async () => allOriginal),
      videoPath: allFinal,
    });
    assert.equal(await fs.readFile(allFinal, "utf8"), "all");
    await assertMissing(allOriginal);

    const passedOriginal = path.join(directory, "passed-original.webm");
    const passedFinal = path.join(directory, "passed-final.webm");
    await fs.writeFile(passedOriginal, "passed");
    await finalizeScenarioVideo({
      mode: "on-failure",
      ok: true,
      page: fakePage(async () => passedOriginal),
      videoPath: passedFinal,
    });
    await assertMissing(passedOriginal);
    await assertMissing(passedFinal);

    const failedOriginal = path.join(directory, "failed-original.webm");
    const failedFinal = path.join(directory, "failed-final.webm");
    await fs.writeFile(failedOriginal, "failed");
    await finalizeScenarioVideo({
      mode: "on-failure",
      ok: false,
      page: fakePage(async () => failedOriginal),
      videoPath: failedFinal,
    });
    assert.equal(await fs.readFile(failedFinal, "utf8"), "failed");

    const promoted = path.join(directory, "promoted.webm");
    const outer = path.join(directory, "outer.webm");
    await fs.writeFile(promoted, "inner");
    await fs.writeFile(outer, "outer");
    await finalizeOrDiscardVideo({
      mode: "all",
      ok: true,
      page: fakePage(async () => outer),
      videoPath: promoted,
    });
    assert.equal(await fs.readFile(promoted, "utf8"), "inner");
    await assertMissing(outer);
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
  console.log("video artifact contract: retain and discard modes unchanged");
}

async function checkVideoFailures(): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "scenario-teardown-video-failure-")
  );
  try {
    await assert.rejects(
      finalizeScenarioVideo({
        mode: "all",
        ok: true,
        page: fakePage(async () => {
          throw new Error("injected failure: video.path");
        }),
        videoPath: path.join(directory, "path-failure.webm"),
      }),
      /injected failure: video\.path/
    );

    const original = path.join(directory, "original.webm");
    const destinationDirectory = path.join(directory, "destination-directory");
    await fs.writeFile(original, "video");
    await fs.mkdir(destinationDirectory);
    await assert.rejects(
      finalizeScenarioVideo({
        mode: "all",
        ok: true,
        page: fakePage(async () => original),
        videoPath: destinationDirectory,
      })
    );

    const missingOriginal = path.join(directory, "missing-original.webm");
    await assert.rejects(
      finalizeScenarioVideo({
        mode: "all",
        ok: true,
        page: fakePage(async () => missingOriginal),
        videoPath: path.join(directory, "missing-final.webm"),
      }),
      (error: unknown) => {
        assert(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.match(error.message, /ENOENT/);
        return true;
      }
    );

    const promoted = path.join(directory, "promoted.webm");
    await fs.writeFile(promoted, "inner");
    await assert.rejects(
      finalizeOrDiscardVideo({
        mode: "all",
        ok: true,
        page: fakePage(async () => {
          throw new Error("injected failure: outer video.path");
        }),
        videoPath: promoted,
      }),
      /injected failure: outer video\.path/
    );
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
  console.log(
    "video cleanup failures: filesystem and path failures propagated"
  );
}

await checkSuccessfulOrder();
await checkEachStageFailure();
await checkMultipleFailures();
await checkFailureDiagnostics();
await checkDiagnosticReasonAttachments();
await checkOptionalStages();
await checkTeardownFailureDiagnostics();
await checkVideoArtifactContract();
await checkVideoFailures();
