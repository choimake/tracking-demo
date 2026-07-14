import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { e2eScenarios } from "./scenarios.js";

interface CatalogEntry {
  id: string;
  name: string;
}

function assertUnique(
  entries: readonly CatalogEntry[],
  field: keyof CatalogEntry,
  source: string
): void {
  const values = entries.map((entry) => entry[field]);
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index
  );
  assert.deepEqual(
    [...new Set(duplicates)],
    [],
    `${source}の${field}が重複しています`
  );
}

export function verifyScenarioCatalog(): void {
  const matrixPath = fileURLToPath(
    new URL("../../docs/e2e-coverage-matrix.md", import.meta.url)
  );
  const matrix = readFileSync(matrixPath, "utf8");
  const catalogSection = matrix.match(
    /## 登録済みシナリオ\n(?<catalog>[\s\S]*?)\n## /
  )?.groups?.catalog;
  assert.ok(
    catalogSection,
    "E2E Coverage Matrixに登録済みシナリオ節がありません"
  );

  const catalogEntries = [
    ...catalogSection.matchAll(
      /^\| `(scenario-[1-9][0-9]*)`\s*\| (.*?)\s*\|/gm
    ),
  ].map((match, index) => {
    const id = match.at(1);
    const name = match.at(2);
    assert.ok(id, `E2E Coverage Matrixの${index + 1}件目にIDがありません`);
    assert.ok(name, `E2E Coverage Matrixの${index + 1}件目に名称がありません`);
    return { id, name: name.trim() };
  });
  const registeredEntries = e2eScenarios.map(({ id, name }) => ({ id, name }));

  assertUnique(registeredEntries, "id", "scenarios.ts");
  assertUnique(registeredEntries, "name", "scenarios.ts");
  assertUnique(catalogEntries, "id", "E2E Coverage Matrix");
  assertUnique(catalogEntries, "name", "E2E Coverage Matrix");

  assert.deepEqual(
    registeredEntries.map(({ id }) => id),
    registeredEntries.map((_, index) => `scenario-${index + 1}`),
    "stable IDは登録順に連番で付け、既存シナリオを並べ替えずに末尾へ追加してください"
  );
  assert.deepEqual(
    catalogEntries,
    registeredEntries,
    "E2E Coverage MatrixのID、名称、件数、順序がscenarios.tsと一致しません"
  );
}
