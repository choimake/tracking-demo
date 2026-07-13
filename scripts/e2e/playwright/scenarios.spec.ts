import { selectE2eScenarios } from "../harness/scenario-selection.js";
import { verifyScenarioCatalog } from "../scenario-catalog.js";
import { e2eScenarios } from "../scenarios.js";
import { assertionError, runWithAssertionContext } from "../tracking/index.js";
import { test } from "./fixtures.js";

export const E2E_EXECUTION_METADATA = {
  mode: "default",
  reason:
    "同一runの全ケースが共有fixtureと専用DBを使うため、workerごとのDB隔離を導入するまで直列実行する",
} as const;

verifyScenarioCatalog();
const selection = selectE2eScenarios(e2eScenarios);
console.log(
  `[e2e] order=${selection.order} seed=${selection.seed ?? "none"} scenarios=${selection.scenarios.map((scenario) => scenario.id).join(",")}`
);

test.describe(
  "tracking E2E",
  {
    annotation: {
      type: "scheduling-reason",
      description: E2E_EXECUTION_METADATA.reason,
    },
  },
  () => {
    for (const scenario of selection.scenarios) {
      test(scenario.name, async ({ e2eContext }) => {
        await runWithAssertionContext(
          {
            browser: e2eContext.browserName,
            correlationId: e2eContext.correlationId,
            repeat: e2eContext.repeat,
            scenarioId: e2eContext.scenarioId,
            seed: e2eContext.seed,
          },
          async () => {
            if (process.env.E2E_HANG_SCENARIO === scenario.name) {
              await new Promise(() => {});
            }
            await scenario.run(e2eContext);
            if (process.env.E2E_FAIL_SCENARIO === scenario.name) {
              throw assertionError({
                actual: { injectedFailure: scenario.name },
                context: { environmentVariable: "E2E_FAIL_SCENARIO" },
                expected: { injectedFailure: null },
                name: "injected-scenario-failure",
                summary: `E2E_FAIL_SCENARIO による意図的な失敗: ${scenario.name}`,
              });
            }
          }
        );
      });
    }
  }
);
