import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

interface AssertionMutant {
  name: string;
  before: string;
  after: string;
  expectedFailure: string;
}

const mutants: AssertionMutant[] = [
  {
    after: "if (false) {",
    before: "if (actualCount > expectedCount) {",
    expectedFailure: "到達待ち途中に期待件数を超過した場合は失敗する",
    name: "到達待ち途中の超過判定を削除",
  },
  {
    after: "if (actualCount < expectedCount) {",
    before: "if (actualCount !== expectedCount) {",
    expectedFailure: "1件期待へ2件投入した場合は失敗する",
    name: "exact判定を最低件数判定へ変更",
  },
  {
    after: "if (false) {",
    before: "if (actualCount !== 0) {",
    expectedFailure: "観測窓の末尾直前に投入したHitを検出する",
    name: "zero判定を削除",
  },
];

export async function runAssertionsMutationCheck(): Promise<void> {
  const assertionsPath = fileURLToPath(
    new URL("./assertions.ts", import.meta.url)
  );
  const contractPath = fileURLToPath(
    new URL("./assertions.regression-contract.ts", import.meta.url)
  );
  const original = await fs.readFile(assertionsPath, "utf8");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-assertions-"));
  try {
    for (const mutant of mutants) {
      assert.equal(
        original.split(mutant.before).length - 1,
        1,
        `${mutant.name}: 置換対象は1箇所`
      );
      const mutated = original.replace(mutant.before, mutant.after);
      const entryPath = path.join(tempDir, "entry.ts");
      const outputPath = path.join(tempDir, "mutant.mjs");
      await fs.writeFile(
        entryPath,
        `import * as assertions from ${JSON.stringify(assertionsPath)};\n` +
          `import { runAssertionsRegressionContract } from ${JSON.stringify(contractPath)};\n` +
          "await runAssertionsRegressionContract(assertions);\n"
      );
      await build({
        bundle: true,
        entryPoints: [entryPath],
        format: "esm",
        outfile: outputPath,
        packages: "external",
        platform: "node",
        plugins: [
          {
            name: "assertion-mutant",
            setup(buildApi) {
              // assertions.tsの絶対パスへマッチする。例: `/repo/scripts/e2e/tracking/assertions.ts`。
              buildApi.onLoad({ filter: /assertions\.ts$/ }, () => ({
                contents: mutated,
                loader: "ts",
                resolveDir: path.dirname(assertionsPath),
              }));
            },
          },
        ],
      });
      const result = spawnSync(process.execPath, [outputPath], {
        encoding: "utf8",
      });
      if (result.status === 0) {
        throw new Error(`${mutant.name}: mutant が生存`);
      }
      const output = `${result.stdout}\n${result.stderr}`;
      if (!output.includes(mutant.expectedFailure)) {
        throw new Error(`${mutant.name}: 回帰契約以外の理由で非0終了`);
      }
      console.log(`  ✓ killed: ${mutant.name}`);
    }
    console.log("assertions mutation check: PASS");
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runAssertionsMutationCheck();
}
