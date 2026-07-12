import assert from "node:assert/strict";

import type { E2eScenario } from "../scenarios.js";
import { selectE2eScenarios } from "./scenario-selection.js";

const scenarios: E2eScenario[] = [
  { id: "a", name: "A", run: async () => {} },
  { id: "b", name: "B", run: async () => {}, tags: ["cookie"] },
  { id: "c", name: "C", run: async () => {}, tags: ["cookie"] },
  { id: "d", name: "D", run: async () => {} },
];

assert.deepEqual(
  selectE2eScenarios(scenarios, { E2E_SCENARIOS: "c" }).scenarios.map(
    ({ id }) => id
  ),
  ["c"]
);
assert.deepEqual(
  selectE2eScenarios(scenarios, { E2E_TAGS: "cookie" }).scenarios.map(
    ({ id }) => id
  ),
  ["b", "c"]
);
assert.deepEqual(
  selectE2eScenarios(scenarios, { E2E_ORDER: "reverse" }).scenarios.map(
    ({ id }) => id
  ),
  ["d", "c", "b", "a"]
);

const randomEnvironment = { E2E_ORDER: "random", E2E_SEED: "20260712" };
const first = selectE2eScenarios(scenarios, randomEnvironment).scenarios.map(
  ({ id }) => id
);
const reproduced = selectE2eScenarios(
  scenarios,
  randomEnvironment
).scenarios.map(({ id }) => id);
assert.deepEqual(reproduced, first);
assert.notDeepEqual(
  first,
  scenarios.map(({ id }) => id)
);
assert.throws(
  () => selectE2eScenarios(scenarios, { E2E_ORDER: "random" }),
  /E2E_SEED/
);
assert.throws(
  () => selectE2eScenarios(scenarios, { E2E_SCENARIOS: "unknown" }),
  /0件/
);

console.log("scenario selection regression check: OK");
