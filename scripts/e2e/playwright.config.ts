import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

import { isE2eMobile, parseE2eBrowsers } from "./harness/project-options.js";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const mobile = isE2eMobile();

export default defineConfig({
  testDir: path.join(E2E_DIR, "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 0,
  globalSetup: path.join(E2E_DIR, "playwright/global-setup.ts"),
  projects: parseE2eBrowsers().map((browserName) => ({
    name: mobile ? `${browserName}:mobile` : browserName,
    use: { browserName },
  })),
});
