import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

import { SCENARIO_TIMEOUT_MS } from "./harness/config.js";
import { isE2eMobile, parseE2eBrowsers } from "./harness/project-options.js";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const mobile = isE2eMobile();

export default defineConfig({
  testDir: path.join(E2E_DIR, "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: Number(process.env.E2E_REPEAT) || 1,
  timeout: Number(process.env.E2E_SCENARIO_TIMEOUT_MS) || SCENARIO_TIMEOUT_MS,
  outputDir: path.resolve("test-results", "playwright"),
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["junit", { outputFile: "test-results/e2e-junit.xml" }],
      ]
    : [["list"]],
  globalSetup: path.join(E2E_DIR, "playwright/global-setup.ts"),
  projects: parseE2eBrowsers().map((browserName) => ({
    name: mobile ? `${browserName}:mobile` : browserName,
    use: { browserName },
  })),
});
