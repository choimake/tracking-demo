import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(E2E_DIR, "../..");
const CHECK_PATH = path.join(E2E_DIR, "architecture-check.ts");
const FIXTURE_DIR = path.join(E2E_DIR, "architecture-fixtures");

interface CustomRuleFixture {
  fixture: string;
  rule: string;
  target: string;
}

const customRuleFixtures: CustomRuleFixture[] = [
  {
    fixture: "tests-no-locator.fixture",
    rule: "tests-no-locator",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-get-by-role.fixture",
    rule: "tests-no-get-by-role",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-page-evaluate.fixture",
    rule: "tests-no-page-evaluate",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-page-evaluate-method-alias.fixture",
    rule: "tests-no-page-evaluate",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-page-evaluate-destructure.fixture",
    rule: "tests-no-page-evaluate",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-page-route.fixture",
    rule: "tests-no-raw-route",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-context-route.fixture",
    rule: "tests-no-raw-route",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-context-route-alias.fixture",
    rule: "tests-no-raw-route",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-derived-page-route.fixture",
    rule: "tests-no-raw-route",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "tests-no-route-method-alias.fixture",
    rule: "tests-no-raw-route",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "anon-vid-regex.fixture",
    rule: "anon-id-regex-single-source",
    target: "scripts/e2e/tracking/duplicate.ts",
  },
  {
    fixture: "anon-sid-regex.fixture",
    rule: "anon-id-regex-single-source",
    target: "scripts/e2e/tests/duplicate.ts",
  },
  {
    fixture: "timeout-constant.fixture",
    rule: "timeout-constant-in-config",
    target: "scripts/e2e/browser/timeout.ts",
  },
];

function writeFixtureRoot(
  fixture: string,
  target: string,
  allowlist: unknown = []
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-architecture-"));
  const targetPath = path.join(root, target);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(
    targetPath,
    fs.readFileSync(path.join(FIXTURE_DIR, fixture), "utf8")
  );
  const allowlistPath = path.join(
    root,
    "scripts/e2e/architecture-allowlist.json"
  );
  fs.writeFileSync(allowlistPath, `${JSON.stringify(allowlist, null, 2)}\n`);
  return root;
}

function runCustomCheck(root: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CHECK_PATH, "--root", root],
    { cwd: ROOT, encoding: "utf8" }
  );
}

for (const fixture of customRuleFixtures) {
  const root = writeFixtureRoot(fixture.fixture, fixture.target);
  try {
    const result = runCustomCheck(root);
    assert.notEqual(result.status, 0, `${fixture.fixture}を検出できない`);
    assert.match(
      `${result.stdout}${result.stderr}`,
      new RegExp(`\\[${fixture.rule}\\]`),
      `${fixture.fixture}の規則IDが出力されない`
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

const regressionTimeoutRoot = writeFixtureRoot(
  "timeout-constant.fixture",
  "scripts/e2e/tracking/timeout.regression-check.ts"
);
try {
  const result = runCustomCheck(regressionTimeoutRoot);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
} finally {
  fs.rmSync(regressionTimeoutRoot, { force: true, recursive: true });
}

const methodScopeRoot = writeFixtureRoot(
  "page-evaluate-scope-isolation.fixture",
  "scripts/e2e/tests/method-scope.ts"
);
try {
  const result = runCustomCheck(methodScopeRoot);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
} finally {
  fs.rmSync(methodScopeRoot, { force: true, recursive: true });
}

const routeScopeRoot = writeFixtureRoot(
  "managed-route-scope-isolation.fixture",
  "scripts/e2e/tests/managed-route.ts"
);
try {
  const result = runCustomCheck(routeScopeRoot);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
} finally {
  fs.rmSync(routeScopeRoot, { force: true, recursive: true });
}

const allowedRoot = writeFixtureRoot(
  "tests-no-page-evaluate.fixture",
  "scripts/e2e/tests/allowed.ts",
  [
    {
      file: "scripts/e2e/tests/allowed.ts",
      rule: "tests-no-page-evaluate",
      reason: "同一tickで2操作を実行する必要があるため",
    },
  ]
);
try {
  const result = runCustomCheck(allowedRoot);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
} finally {
  fs.rmSync(allowedRoot, { force: true, recursive: true });
}

const missingReasonRoot = writeFixtureRoot(
  "tests-no-page-evaluate.fixture",
  "scripts/e2e/tests/missing-reason.ts",
  [
    {
      file: "scripts/e2e/tests/missing-reason.ts",
      rule: "tests-no-page-evaluate",
      reason: "",
    },
  ]
);
try {
  const result = runCustomCheck(missingReasonRoot);
  assert.notEqual(result.status, 0, "理由のないallowlist登録を受理した");
  assert.match(`${result.stdout}${result.stderr}`, /reasonは空でない文字列/);
} finally {
  fs.rmSync(missingReasonRoot, { force: true, recursive: true });
}

const staleRoot = writeFixtureRoot(
  "tests-no-page-evaluate.fixture",
  "scripts/e2e/tests/stale.ts",
  [
    {
      file: "scripts/e2e/tests/stale.ts",
      rule: "tests-no-locator",
      reason: "別規則を誤って登録したfixture",
    },
  ]
);
try {
  const result = runCustomCheck(staleRoot);
  assert.notEqual(result.status, 0, "違反と一致しないallowlist登録を受理した");
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /tests-no-page-evaluate/);
  assert.match(output, /未使用のallowlist登録/);
} finally {
  fs.rmSync(staleRoot, { force: true, recursive: true });
}

const secondViolationRoot = writeFixtureRoot(
  "allowlist-second-violation.fixture",
  "scripts/e2e/tests/second-violation.ts",
  [
    {
      file: "scripts/e2e/tests/second-violation.ts",
      rule: "tests-no-page-evaluate",
      reason: "1件目だけを許可するfixture",
    },
  ]
);
try {
  const result = runCustomCheck(secondViolationRoot);
  assert.notEqual(result.status, 0, "allowlistが同じ規則の2件目も許可した");
  assert.match(`${result.stdout}${result.stderr}`, /tests-no-page-evaluate/);
} finally {
  fs.rmSync(secondViolationRoot, { force: true, recursive: true });
}

const deepImportFixtures = [
  {
    file: "browser-deep-import.fixture",
    rule: "e2e-tests-browser-barrel-import",
  },
  {
    file: "tracking-deep-import.fixture",
    rule: "e2e-tests-tracking-barrel-import",
  },
] as const;

for (const fixture of deepImportFixtures) {
  const relativeTarget = `scripts/e2e/tests/.architecture-${fixture.file}.tmp.ts`;
  const absoluteTarget = path.join(ROOT, relativeTarget);
  fs.writeFileSync(
    absoluteTarget,
    fs.readFileSync(path.join(FIXTURE_DIR, fixture.file), "utf8")
  );
  try {
    const result = spawnSync(
      "mise",
      [
        "exec",
        "--",
        "depcruise",
        "--config",
        ".dependency-cruiser.cjs",
        relativeTarget,
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    assert.notEqual(result.status, 0, `${fixture.file}を検出できない`);
    assert.match(
      `${result.stdout}${result.stderr}`,
      new RegExp(fixture.rule),
      `${fixture.file}の規則IDが出力されない`
    );
  } finally {
    fs.rmSync(absoluteTarget, { force: true });
  }
}

console.log(
  `E2E architecture regression check: OK (${customRuleFixtures.length + deepImportFixtures.length} violation fixtures, regression-timeout exclusion, method-alias/managed-route scope isolation, allowlist allow/missing-reason/stale/second-violation)`
);
