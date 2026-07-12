import { e2eScenarios } from "../scenarios.js";
import { test } from "./fixtures.js";

for (const scenario of e2eScenarios) {
  test(scenario.name, async ({ e2eContext }) => {
    await scenario.run(e2eContext);
  });
}
