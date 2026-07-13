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
    fixture: "fire-assertion-helper-required.fixture",
    rule: "tests-fire-assertion-helper-required",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "fixed-wait-abort-signal.fixture",
    rule: "fixed-wait-registration",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "fixed-wait-sleep.fixture",
    rule: "fixed-wait-registration",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "fixed-wait-playwright.fixture",
    rule: "fixed-wait-registration",
    target: "scripts/e2e/tests/violation.ts",
  },
  {
    fixture: "fixed-wait-set-timeout.fixture",
    rule: "fixed-wait-registration",
    target: "scripts/e2e/tests/violation.ts",
  },
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

for (const fixture of [
  "fire-assertion-helper-allowed.fixture",
  "fire-assertion-negative-allowed.fixture",
]) {
  const root = writeFixtureRoot(fixture, "scripts/e2e/tests/allowed-fire.ts");
  try {
    const result = runCustomCheck(root);
    assert.equal(
      result.status,
      0,
      `${fixture}: ${result.stdout}${result.stderr}`
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

const registeredWaitRoot = writeFixtureRoot(
  "fixed-wait-registered.fixture",
  "scripts/e2e/tests/registered.ts",
  [
    {
      classification: "polling",
      contractId: "FIXTURE-POLL-001",
      durationMs: 100,
      file: "scripts/e2e/tests/registered.ts",
      reason: "登録済みpolling待機を許可するfixture",
      rule: "fixed-wait-registration",
      toleranceMs: 100,
      waitId: "fixture-registered-wait",
    },
  ]
);
try {
  const result = runCustomCheck(registeredWaitRoot);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
} finally {
  fs.rmSync(registeredWaitRoot, { force: true, recursive: true });
}

const outOfRangeWaitRoot = writeFixtureRoot(
  "fixed-wait-out-of-range.fixture",
  "scripts/e2e/tests/out-of-range.ts",
  [
    {
      classification: "polling",
      contractId: "FIXTURE-POLL-001",
      durationMs: 100,
      file: "scripts/e2e/tests/out-of-range.ts",
      reason: "許容幅外の待機を拒否するfixture",
      rule: "fixed-wait-registration",
      toleranceMs: 100,
      waitId: "fixture-registered-wait",
    },
  ]
);
try {
  const result = runCustomCheck(outOfRangeWaitRoot);
  assert.notEqual(result.status, 0, "許容幅外の固定待機を受理した");
  assert.match(`${result.stdout}${result.stderr}`, /fixed-wait-registration/);
} finally {
  fs.rmSync(outOfRangeWaitRoot, { force: true, recursive: true });
}

const duplicateWaitIdEntry = {
  classification: "polling",
  contractId: "FIXTURE-POLL-001",
  durationMs: 100,
  reason: "wait ID重複を拒否するfixture",
  rule: "fixed-wait-registration",
  toleranceMs: 100,
  waitId: "fixture-registered-wait",
};
const duplicateWaitIdRoot = writeFixtureRoot(
  "fixed-wait-registered.fixture",
  "scripts/e2e/tests/duplicate-wait-id.ts",
  [
    {
      ...duplicateWaitIdEntry,
      file: "scripts/e2e/tests/duplicate-wait-id.ts",
    },
    {
      ...duplicateWaitIdEntry,
      file: "scripts/e2e/tracking/duplicate-wait-id.ts",
    },
  ]
);
try {
  const result = runCustomCheck(duplicateWaitIdRoot);
  assert.notEqual(result.status, 0, "別fileの同一wait ID登録を受理した");
  assert.match(`${result.stdout}${result.stderr}`, /固定待機waitId/);
} finally {
  fs.rmSync(duplicateWaitIdRoot, { force: true, recursive: true });
}

const missingWaitMetadataRoot = writeFixtureRoot(
  "fixed-wait-registered.fixture",
  "scripts/e2e/tests/missing-wait-metadata.ts",
  [
    {
      file: "scripts/e2e/tests/missing-wait-metadata.ts",
      reason: "metadata不足を拒否するfixture",
      rule: "fixed-wait-registration",
    },
  ]
);
try {
  const result = runCustomCheck(missingWaitMetadataRoot);
  assert.notEqual(result.status, 0, "metadataのない固定待機登録を受理した");
  assert.match(`${result.stdout}${result.stderr}`, /classification/);
} finally {
  fs.rmSync(missingWaitMetadataRoot, { force: true, recursive: true });
}

const mismatchedDefinitionRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "e2e-wait-definition-")
);
try {
  const actualAllowlistPath = path.join(
    ROOT,
    "scripts/e2e/architecture-allowlist.json"
  );
  const mismatchedAllowlist = JSON.parse(
    fs.readFileSync(actualAllowlistPath, "utf8")
  ) as Array<Record<string, unknown>>;
  const target = mismatchedAllowlist.find(
    (entry) => entry.waitId === "tracking-condition-poll"
  );
  assert(target, "定義不一致fixtureの対象登録がない");
  target.durationMs = 201;
  const mismatchedAllowlistPath = path.join(
    mismatchedDefinitionRoot,
    "architecture-allowlist.json"
  );
  fs.writeFileSync(
    mismatchedAllowlistPath,
    `${JSON.stringify(mismatchedAllowlist, null, 2)}\n`
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      CHECK_PATH,
      "--root",
      ROOT,
      "--allowlist",
      mismatchedAllowlistPath,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0, "固定待機定義と異なる登録を受理した");
  assert.match(
    `${result.stdout}${result.stderr}`,
    /固定待機定義とallowlistが不一致/
  );
} finally {
  fs.rmSync(mismatchedDefinitionRoot, { force: true, recursive: true });
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

const dependencyCruiserFixtures = [
  {
    file: "tracking-fire-assertion-helper-reverse.fixture",
    rule: "e2e-tracking-fire-assertion-helper-direction",
    target: "scripts/e2e/tracking/client/.architecture-fire-helper.tmp.ts",
  },
  {
    file: "browser-deep-import.fixture",
    rule: "e2e-tests-browser-barrel-import",
    target: "scripts/e2e/tests/.architecture-browser-deep-import.tmp.ts",
  },
  {
    file: "tracking-deep-import.fixture",
    rule: "e2e-tests-tracking-barrel-import",
    target: "scripts/e2e/tests/.architecture-tracking-deep-import.tmp.ts",
  },
  {
    file: "browser-module-reverse.fixture",
    rule: "e2e-browser-module-direction",
    target: "scripts/e2e/browser/navigation/.architecture-reverse.tmp.ts",
  },
  {
    file: "browser-input-reverse.fixture",
    rule: "e2e-browser-input-direction",
    target: "scripts/e2e/browser/input/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-parser-reverse.fixture",
    rule: "e2e-tracking-response-parser-is-leaf",
    target: "scripts/e2e/tracking/response-parser/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-transport-reverse.fixture",
    rule: "e2e-tracking-transport-direction",
    target: "scripts/e2e/tracking/transport/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-admin-reverse.fixture",
    rule: "e2e-tracking-admin-api-direction",
    target: "scripts/e2e/tracking/admin-api/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-observation-reverse.fixture",
    rule: "e2e-tracking-observation-api-direction",
    target: "scripts/e2e/tracking/observation-api/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-assertion-reverse.fixture",
    rule: "e2e-tracking-assertion-direction",
    target:
      "scripts/e2e/tracking/count-assertions/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-client-reverse.fixture",
    rule: "e2e-tracking-client-not-to-assertions",
    target: "scripts/e2e/tracking/client/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-formatter-reverse.fixture",
    rule: "e2e-tracking-assertion-formatter-is-leaf",
    target:
      "scripts/e2e/tracking/assertion-formatter/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-polling-reverse.fixture",
    rule: "e2e-tracking-polling-not-to-count-or-log",
    target: "scripts/e2e/tracking/polling/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-log-reverse.fixture",
    rule: "e2e-tracking-log-not-to-count",
    target: "scripts/e2e/tracking/log-assertions/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-count-log-reverse.fixture",
    rule: "e2e-tracking-count-not-to-log",
    target:
      "scripts/e2e/tracking/count-assertions/.architecture-log-reverse.tmp.ts",
  },
  {
    file: "tracking-hit-log-reverse.fixture",
    rule: "e2e-tracking-hit-payload-not-to-log",
    target:
      "scripts/e2e/tracking/hit-payload-assertions/.architecture-reverse.tmp.ts",
  },
  {
    file: "tracking-hit-index-reverse.fixture",
    rule: "e2e-tracking-assertion-direction",
    target:
      "scripts/e2e/tracking/hit-payload-assertions/.architecture-index-reverse.tmp.ts",
  },
] as const;

for (const fixture of dependencyCruiserFixtures) {
  const relativeTarget = fixture.target;
  const absoluteTarget = path.join(ROOT, relativeTarget);
  fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
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
    const targetDirectory = path.dirname(absoluteTarget);
    if (targetDirectory !== path.join(ROOT, "scripts/e2e/tests")) {
      fs.rmdirSync(targetDirectory);
    }
  }
}

const cycleTargets = [
  {
    fixture: "tracking-cycle-a.fixture",
    target: "scripts/e2e/tracking/.architecture-cycle-a.tmp.ts",
  },
  {
    fixture: "tracking-cycle-b.fixture",
    target: "scripts/e2e/tracking/.architecture-cycle-b.tmp.ts",
  },
];
for (const item of cycleTargets) {
  fs.writeFileSync(
    path.join(ROOT, item.target),
    fs.readFileSync(path.join(FIXTURE_DIR, item.fixture), "utf8")
  );
}
try {
  const result = spawnSync(
    "mise",
    [
      "exec",
      "--",
      "depcruise",
      "--config",
      ".dependency-cruiser.cjs",
      ...cycleTargets.map((item) => item.target),
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0, "循環依存fixtureを検出できない");
  assert.match(`${result.stdout}${result.stderr}`, /no-circular/);
} finally {
  for (const item of cycleTargets) {
    fs.rmSync(path.join(ROOT, item.target), { force: true });
  }
}

console.log(
  `E2E architecture regression check: OK (${customRuleFixtures.length + dependencyCruiserFixtures.length + cycleTargets.length} violation fixtures, regression-timeout exclusion, method-alias/managed-route scope isolation, allowlist allow/missing-reason/stale/second-violation)`
);
