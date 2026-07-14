import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(E2E_DIR, "../..");
const CHECK = path.join(E2E_DIR, "boundary-architecture-check.ts");
const FIXTURES = path.join(E2E_DIR, "boundary-architecture-fixtures");
// toggle routeの宣言全体にマッチする。例: `app.post("/api/events/:id/toggle", ...);`。
const TOGGLE_ROUTE_PATTERN =
  /app\.post\("\/api\/events\/:id\/toggle"[\s\S]*?\n\s*\}\);/;

function copyCheckRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-architecture-"));
  fs.cpSync(path.join(ROOT, "src"), path.join(root, "src"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  for (const name of ["boundary-inventory.json", "boundary-inventory.md"]) {
    fs.copyFileSync(
      path.join(ROOT, "docs", name),
      path.join(root, "docs", name)
    );
  }
  fs.mkdirSync(path.join(root, "scripts/e2e"), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "scripts/e2e/scenarios.ts"),
    path.join(root, "scripts/e2e/scenarios.ts")
  );
  fs.copyFileSync(
    path.join(ROOT, "scripts/boundary-contract.regression-check.ts"),
    path.join(root, "scripts/boundary-contract.regression-check.ts")
  );
  fs.copyFileSync(
    path.join(ROOT, "package.json"),
    path.join(root, "package.json")
  );
  return root;
}

function runCheck(root: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CHECK, "--root", root],
    { cwd: ROOT, encoding: "utf8" }
  );
}

const baseline = runCheck(ROOT);
assert.equal(baseline.status, 0, `${baseline.stdout}${baseline.stderr}`);

const requestBypassFixtures = [
  "boundary-validation-bypass.fixture",
  "boundary-request-destructuring-bypass.fixture",
  "boundary-request-alias-bypass.fixture",
  "boundary-request-cast-bypass.fixture",
  "boundary-request-headers-bypass.fixture",
] as const;

for (const fixture of requestBypassFixtures) {
  const validationRoot = copyCheckRoot();
  try {
    const serverPath = path.join(validationRoot, "src/server.ts");
    const source = fs.readFileSync(serverPath, "utf8");
    const bypass = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
    const replaced = source.replace(TOGGLE_ROUTE_PATTERN, bypass.trim());
    assert.notEqual(replaced, source, `${fixture}: routeを置換できない`);
    fs.writeFileSync(serverPath, replaced);
    const result = runCheck(validationRoot);
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(
      result.status,
      0,
      `${fixture}: validation迂回を検出できない`
    );
    assert(output.includes("src-validation-bypass"), `${fixture}: ${output}`);
    console.log(
      `request bypass fixture rejected: ${fixture} status=${result.status} rule=src-validation-bypass`
    );
  } finally {
    fs.rmSync(validationRoot, { force: true, recursive: true });
  }
}

const environmentRoot = copyCheckRoot();
try {
  const fixture = "boundary-process-environment-element-access.fixture";
  fs.copyFileSync(
    path.join(FIXTURES, fixture),
    path.join(environmentRoot, "src/environment-bypass.ts")
  );
  const result = runCheck(environmentRoot);
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, `${fixture}: 環境変数迂回を検出できない`);
  assert(output.includes("src-environment-owner"), `${fixture}: ${output}`);
  console.log(
    `environment bypass fixture rejected: ${fixture} status=${result.status} rule=src-environment-owner`
  );
} finally {
  fs.rmSync(environmentRoot, { force: true, recursive: true });
}

const swallowedRoot = copyCheckRoot();
try {
  fs.writeFileSync(
    path.join(swallowedRoot, "src/swallowed.ts"),
    fs.readFileSync(
      path.join(FIXTURES, "boundary-swallowed-error.fixture"),
      "utf8"
    )
  );
  const result = runCheck(swallowedRoot);
  assert.notEqual(result.status, 0, "error握り潰しfixtureを検出できない");
  assert(`${result.stdout}${result.stderr}`.includes("src-no-swallowed-error"));
} finally {
  fs.rmSync(swallowedRoot, { force: true, recursive: true });
}

const persistenceRoot = copyCheckRoot();
try {
  const databasePath = path.join(persistenceRoot, "src/db.ts");
  fs.writeFileSync(
    databasePath,
    fs
      .readFileSync(databasePath, "utf8")
      .replaceAll("validatePersistedDatabase", "bypassPersistedDatabase")
  );
  const result = runCheck(persistenceRoot);
  assert.notEqual(result.status, 0, "永続化validation迂回を検出できない");
  assert(`${result.stdout}${result.stderr}`.includes("src-validation-owner"));
} finally {
  fs.rmSync(persistenceRoot, { force: true, recursive: true });
}

const dependencyFixtures = [
  {
    expectedStatus: 1,
    file: "src-deep-import.fixture",
    rule: "src-public-entry-point-only",
    target: "scripts/e2e/.boundary-src-deep-import.tmp.ts",
  },
  {
    expectedStatus: 0,
    file: "src-public-import.fixture",
    rule: "",
    target: "scripts/e2e/.boundary-src-public-import.tmp.ts",
  },
] as const;

for (const fixture of dependencyFixtures) {
  const target = path.join(ROOT, fixture.target);
  fs.copyFileSync(path.join(FIXTURES, fixture.file), target);
  try {
    const result = spawnSync(
      "mise",
      [
        "exec",
        "--",
        "depcruise",
        "--config",
        ".dependency-cruiser.cjs",
        fixture.target,
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    assert.equal(
      result.status === 0 ? 0 : 1,
      fixture.expectedStatus,
      `${fixture.file}: ${result.stdout}${result.stderr}`
    );
    if (fixture.rule) {
      assert(
        `${result.stdout}${result.stderr}`.includes(fixture.rule),
        `${fixture.file}: 規則名を出力しない: ${fixture.rule}`
      );
    }
  } finally {
    fs.rmSync(target, { force: true });
  }
}

console.log(
  "Boundary architecture regression check: OK (request destructuring/alias/cast/headers, process environment element access, HTTP/persistence validation bypass, swallowed error, deep/public import fixtures)"
);
