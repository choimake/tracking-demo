import { selectE2eScenarios } from "../harness/scenario-selection.js";
import { e2eScenarios } from "../scenarios.js";
import { test } from "./fixtures.js";

export const E2E_EXECUTION_METADATA = {
  mode: "default",
  reason:
    "同一runの全ケースが共有fixtureと専用DBを使うため、workerごとのDB隔離を導入するまで直列実行する",
} as const;

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
        if (process.env.E2E_HANG_SCENARIO === scenario.name) {
          await new Promise(() => {});
        }
        await scenario.run(e2eContext);
        if (process.env.E2E_FAIL_SCENARIO === scenario.name) {
          throw new Error(
            `E2E_FAIL_SCENARIO による意図的な失敗: ${scenario.name}`
          );
        }
      });
    }
  }
);
