import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

import type { SCENARIO_TIMEOUT_MS as ScenarioTimeoutMs } from "./harness/config.js";
import { isE2eMobile, parseE2eBrowsers } from "./harness/project-options.js";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCENARIO_TIMEOUT_MS = 60_000 satisfies typeof ScenarioTimeoutMs;
const mobile = isE2eMobile();

export default defineConfig({
  testDir: path.join(E2E_DIR, "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: Number(process.env.E2E_REPEAT) || 1,
  timeout:
    Number(process.env.E2E_SCENARIO_TIMEOUT_MS) || DEFAULT_SCENARIO_TIMEOUT_MS,
  outputDir: path.resolve("test-results", "playwright"),
  use: {
    screenshot: { fullPage: true, mode: "only-on-failure" },
    trace: "retain-on-failure",
  },
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { open: "never" }],
        ["junit", { outputFile: "test-results/e2e-junit.xml" }],
      ]
    : [["list"], ["html", { open: "never" }]],
  globalSetup: path.join(E2E_DIR, "playwright/global-setup.ts"),
  projects: parseE2eBrowsers().map((browserName) => ({
    name: mobile ? `${browserName}:mobile` : browserName,
    use: { browserName },
  })),
});
