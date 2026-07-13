export interface ScenarioTeardownStage {
  name: string;
  run: () => Promise<void>;
}

interface FailureDiagnosticsOptions {
  attachJson: (name: string, value: unknown) => Promise<void>;
  attachStackLog?: () => Promise<void>;
  getCorrelatedHits: () => Promise<unknown>;
}

export interface ScenarioFixtureTeardownOptions {
  cleanupVideo?: () => Promise<void>;
  closeBrowserContext: () => Promise<void>;
  failureDiagnostics?: () => Promise<void>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function correlatedHitsAttachError(
  error: unknown,
  attachError: unknown
): AggregateError {
  return new AggregateError(
    [error, attachError],
    `correlated-hitsとcorrelated-hits-errorの添付に失敗しました: ` +
      `${String(error)} | ${String(attachError)}`,
    { cause: attachError }
  );
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

/** 失敗時の診断artifactを全件試行する。 */
export async function attachFailureDiagnostics(
  options: FailureDiagnosticsOptions
): Promise<void> {
  await runScenarioTeardown(
    [
      {
        name: "correlated-hits",
        run: async () => {
          try {
            const hits = await options.getCorrelatedHits();
            await options.attachJson("correlated-hits", hits);
          } catch (error) {
            try {
              await options.attachJson("correlated-hits-error", String(error));
            } catch (attachError) {
              throw correlatedHitsAttachError(error, attachError);
            }
            throw error;
          }
        },
      },
      ...(options.attachStackLog
        ? [{ name: "stack-log", run: options.attachStackLog }]
        : []),
    ],
    "失敗時の診断artifact"
  );
}
