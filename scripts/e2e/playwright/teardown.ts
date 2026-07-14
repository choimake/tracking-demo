export interface ScenarioTeardownStage {
  name: string;
  run: () => Promise<void>;
}

interface FailureDiagnosticsOptions {
  attachJson: (name: string, value: unknown) => Promise<void>;
  attachStackLog?: () => Promise<void>;
  getConsoleLog: () => Promise<unknown>;
  getCorrelatedHits: () => Promise<unknown>;
  getPageErrors: () => Promise<unknown>;
}

export interface ScenarioFixtureTeardownOptions {
  cleanupVideo?: () => Promise<void>;
  closeBrowserContext: () => Promise<void>;
  failureDiagnostics?: () => Promise<void>;
}

export interface ScenarioFixtureLifecycleOptions {
  cleanupVideo?: (ok: boolean) => Promise<void>;
  closeBrowserContext: () => Promise<void>;
  failureDiagnostics: () => Promise<void>;
  scenarioFailed: boolean;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function diagnosticAttachError(
  name: string,
  error: unknown,
  attachError: unknown
): AggregateError {
  return new AggregateError(
    [error, attachError],
    `${name}と${name}-errorの添付に失敗しました: ` +
      `${String(error)} | ${String(attachError)}`,
    { cause: attachError }
  );
}

async function attachJsonDiagnostic(
  options: FailureDiagnosticsOptions,
  name: string,
  getValue: () => Promise<unknown>
): Promise<void> {
  try {
    await options.attachJson(name, await getValue());
  } catch (error) {
    try {
      await options.attachJson(`${name}-error`, describeError(error));
    } catch (attachError) {
      throw diagnosticAttachError(name, error, attachError);
    }
    throw error;
  }
}

async function attachStackDiagnostic(
  options: FailureDiagnosticsOptions
): Promise<void> {
  try {
    await options.attachStackLog?.();
  } catch (error) {
    try {
      await options.attachJson("stack-log-error", describeError(error));
    } catch (attachError) {
      throw diagnosticAttachError("stack-log", error, attachError);
    }
    throw error;
  }
}

/** 各段階を登録順に全件試行し、全失敗を最後に伝播する。 */
export async function runScenarioTeardown(
  stages: readonly ScenarioTeardownStage[],
  scope = "シナリオfixture teardown"
): Promise<void> {
  const errors: Error[] = [];

  for (const stage of stages) {
    try {
      await stage.run();
    } catch (cause) {
      errors.push(
        new Error(`${stage.name}: ${describeError(cause)}`, { cause })
      );
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `${scope}に失敗しました: ${errors.map((error) => error.message).join(" | ")}`
    );
  }
}

/** シナリオfixtureが所有する段階を契約順に実行する。 */
export async function runScenarioFixtureTeardown(
  options: ScenarioFixtureTeardownOptions
): Promise<void> {
  await runScenarioTeardown([
    ...(options.failureDiagnostics
      ? [
          {
            name: "失敗時の診断artifact",
            run: options.failureDiagnostics,
          },
        ]
      : []),
    {
      name: "BrowserContextのclose",
      run: options.closeBrowserContext,
    },
    ...(options.cleanupVideo
      ? [{ name: "video cleanup", run: options.cleanupVideo }]
      : []),
  ]);
}

/** scenario本体とteardownの最終失敗状態に合わせて診断とvideoを保持する。 */
export async function runScenarioFixtureLifecycle(
  options: ScenarioFixtureLifecycleOptions
): Promise<void> {
  const cleanupVideo = options.cleanupVideo;
  let closeFailed = false;
  let teardownError: unknown;
  try {
    await runScenarioFixtureTeardown({
      ...(cleanupVideo
        ? {
            cleanupVideo: () =>
              cleanupVideo(!(options.scenarioFailed || closeFailed)),
          }
        : {}),
      closeBrowserContext: async () => {
        try {
          await options.closeBrowserContext();
        } catch (error) {
          closeFailed = true;
          throw error;
        }
      },
      ...(options.scenarioFailed
        ? { failureDiagnostics: options.failureDiagnostics }
        : {}),
    });
  } catch (error) {
    teardownError = error;
  }
  if (teardownError !== undefined && !options.scenarioFailed) {
    await runScenarioTeardown(
      [
        {
          name: "先行するシナリオfixture teardown",
          run: async () => {
            throw teardownError;
          },
        },
        { name: "後追い診断", run: options.failureDiagnostics },
      ],
      "シナリオfixture teardownと後追い診断"
    );
  }
  if (teardownError !== undefined) throw teardownError;
}

/** 失敗時の診断artifactを全件試行する。 */
export async function attachFailureDiagnostics(
  options: FailureDiagnosticsOptions
): Promise<void> {
  await runScenarioTeardown(
    [
      {
        name: "correlated-hits",
        run: () =>
          attachJsonDiagnostic(
            options,
            "correlated-hits",
            options.getCorrelatedHits
          ),
      },
      {
        name: "console-log",
        run: () =>
          attachJsonDiagnostic(options, "console-log", options.getConsoleLog),
      },
      {
        name: "page-errors",
        run: () =>
          attachJsonDiagnostic(options, "page-errors", options.getPageErrors),
      },
      ...(options.attachStackLog
        ? [{ name: "stack-log", run: () => attachStackDiagnostic(options) }]
        : []),
    ],
    "失敗時の診断artifact"
  );
}
