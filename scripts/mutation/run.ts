/**
 * E2E-oracle ミューテーションランナー。
 * 評価用ハーネスでありプロダクトコードではない。
 *
 * 流れ: baseline → catalog 検証 → 各 mutant(apply→stack→e2e→record→restore) → report
 */
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import type { SuiteWorkerResult } from "../e2e/bench/serial-runner.js";
import type { StackEnv } from "../e2e/bench/stack.js";
import { startStack, stackEnvRecord } from "../e2e/bench/stack.js";
import { e2eScenarios } from "../e2e/scenarios.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const CATALOG_PATH = path.join(ROOT, "docs/mutation-catalog.json");
const RESULTS_PATH = path.join(ROOT, "docs/mutation-results.json");
const REPORT_PATH = path.join(ROOT, "docs/mutation-report.md");
const WORKER_SCRIPT = path.join(ROOT, "scripts/e2e/bench/suite-worker.ts");

const E2E_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 2; // timeout/error の追加試行回数（合計3回）
const PRIMARY_TOTAL = 29;

type MutantClass = "primary" | "control-survived" | "infra";
type AttemptResult = "killed" | "survived" | "timeout" | "error";
type FinalResult = AttemptResult | "skipped";

interface CatalogMutant {
  id: string;
  file: string;
  operator: string;
  change: string;
  beforeString: string;
  afterString: string;
  expectedKillers: string[];
  class: MutantClass;
  rationale?: string;
}

interface AttemptRecord {
  attemptNumber: number;
  result: AttemptResult;
  exitStatus: "pass" | "fail" | null;
  failedScenarioIds: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  errorExcerpt: string | null;
}

interface MutantResult {
  mutantId: string;
  file: string;
  operator: string;
  class: MutantClass;
  expectedKillers: string[];
  attempts: AttemptRecord[];
  finalResult: FinalResult;
  unexpectedKill: boolean;
  unexpectedFailedScenarioIds: string[];
  excludedFromKillRate: boolean;
  exclusionReason: string | null;
}

interface ResultsFile {
  runId: string;
  gitShaBaseline: string;
  catalogSha256: string;
  nodeVersion: string;
  playwrightVersion: string;
  chromiumVersion: string;
  baselineResult: "green" | "aborted";
  startedAt: string;
  endedAt: string;
  totalDurationMs: number;
  mutants: MutantResult[];
}

function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/** resume: 既存 results から finalResult 済みを results へ取り込み、doneIds を返す */
function loadResumedMutants(
  catalogSha256: string,
  results: ResultsFile
): Set<string> {
  const doneIds = new Set<string>();
  if (!fs.existsSync(RESULTS_PATH)) {
    return doneIds;
  }
  try {
    const prev = JSON.parse(
      fs.readFileSync(RESULTS_PATH, "utf8")
    ) as ResultsFile;
    if (
      prev.catalogSha256 !== catalogSha256 ||
      prev.baselineResult !== "green"
    ) {
      return doneIds;
    }
    for (const m of prev.mutants) {
      if (!m.finalResult) {
        continue;
      }
      results.mutants.push(m);
      doneIds.add(m.mutantId);
    }
    results.baselineResult = "green";
    console.log(`resume: ${doneIds.size} mutants already done`);
  } catch {
    // 壊れた JSON は無視して新規
  }
  return doneIds;
}

const SOURCE_PATHS = execFileSync("git", ["ls-files", "--", "src/"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
const SOURCE_BASELINE = new Map(
  SOURCE_PATHS.map((file) => [file, fs.readFileSync(path.join(ROOT, file))])
);
const SOURCE_STATUS_BASELINE = execFileSync(
  "git",
  ["status", "--porcelain", "--", "src/"],
  { cwd: ROOT, encoding: "utf8" }
).trim();

/** src/ 配下がmutation開始時の状態と一致することを確認する。 */
function assertCleanTree(): void {
  const status = execFileSync("git", ["status", "--porcelain", "--", "src/"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (status !== SOURCE_STATUS_BASELINE) {
    throw new Error(
      `src/ の差分がmutation開始時から変化しました:\n開始時:\n${SOURCE_STATUS_BASELINE}\n現在:\n${status}`
    );
  }
  for (const [file, baseline] of SOURCE_BASELINE) {
    const current = fs.readFileSync(path.join(ROOT, file));
    if (!current.equals(baseline)) {
      throw new Error(`src/ の内容がmutation開始時から変化しました: ${file}`);
    }
  }
}

function scenarioIdByName(name: string): string | null {
  const idx = e2eScenarios.findIndex((s) => s.name === name);
  if (idx < 0) {
    return null;
  }
  return `S${String(idx + 1).padStart(2, "0")}`;
}

function loadCatalog(): CatalogMutant[] {
  const raw = JSON.parse(
    fs.readFileSync(CATALOG_PATH, "utf8")
  ) as CatalogMutant[];
  if (raw.length !== 32) {
    throw new Error(`カタログ件数は32であるべき: got ${raw.length}`);
  }
  const primary = raw.filter((m) => m.class === "primary");
  const control = raw.filter((m) => m.class === "control-survived");
  if (primary.length !== 29 || control.length !== 3) {
    throw new Error(
      `内訳不正: primary=${primary.length} control=${control.length}`
    );
  }
  for (const m of primary) {
    if (!m.expectedKillers.length) {
      throw new Error(`${m.id}: primary の expectedKillers が空`);
    }
  }
  for (let i = 1; i <= 18; i++) {
    const sid = `S${String(i).padStart(2, "0")}`;
    const covered = primary.some((m) => m.expectedKillers.includes(sid));
    if (!covered) {
      throw new Error(
        `シナリオ ${sid} を expectedKillers に持つ primary がない`
      );
    }
  }
  for (const m of raw) {
    const abs = path.join(ROOT, m.file);
    const src = fs.readFileSync(abs, "utf8");
    const count = src.split(m.beforeString).length - 1;
    if (count !== 1) {
      throw new Error(
        `${m.id}: beforeString の出現回数が ${count}（ちょうど1である必要）`
      );
    }
  }
  return raw;
}

/** `MUTATION_IDS=M-TR05,M-TR06` があればその ID のみ。未設定時は null(全件) */
function parseMutationIdsFilter(): string[] | null {
  const raw = process.env.MUTATION_IDS?.trim();
  if (!raw) {
    return null;
  }
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error("MUTATION_IDS が空です");
  }
  return ids;
}

function persistResults(data: ResultsFile, filterMode: boolean): void {
  if (filterMode) {
    return;
  }
  writeResultsAtomic(data);
}

function persistReport(data: ResultsFile, filterMode: boolean): void {
  if (filterMode) {
    return;
  }
  fs.writeFileSync(REPORT_PATH, buildReport(data), "utf8");
}

function applyMutant(m: CatalogMutant): void {
  const abs = path.join(ROOT, m.file);
  const src = fs.readFileSync(abs, "utf8");
  const count = src.split(m.beforeString).length - 1;
  if (count !== 1) {
    throw new Error(`${m.id}: apply 時 beforeString 出現=${count}`);
  }
  fs.writeFileSync(abs, src.replace(m.beforeString, m.afterString), "utf8");
}

function restoreFile(file: string): void {
  const baseline = SOURCE_BASELINE.get(file);
  if (!baseline) {
    throw new Error(`mutation開始時の復元元がありません: ${file}`);
  }
  fs.writeFileSync(path.join(ROOT, file), baseline);
}

function writeResultsAtomic(data: ResultsFile): void {
  const tmp = `${RESULTS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, RESULTS_PATH);
}

/** suite-worker を直接 spawn し、タイムアウト時に SIGKILL 可能にする */
function runSuiteWorkerKillable(
  stackEnv: StackEnv,
  timeoutMs: number
): Promise<{
  kind: "ok" | "timeout" | "error";
  result?: SuiteWorkerResult;
  errorExcerpt?: string;
}> {
  type WorkerOutcome = {
    kind: "ok" | "timeout" | "error";
    result?: SuiteWorkerResult;
    errorExcerpt?: string;
  };
  // resolve を executor 外へ逃がし、oxlint promise/no-multiple-resolved を回避する
  let settle!: (value: WorkerOutcome) => void;
  const promise = new Promise<WorkerOutcome>((resolve) => {
    settle = resolve;
  });
  const child: ChildProcess = spawn(
    "npx",
    ["tsx", WORKER_SCRIPT, "--browsers", "chromium"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ...stackEnvRecord(stackEnv),
        E2E_BROWSERS: "chromium",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stdout = "";
  let stderr = "";
  let settled = false;
  const finish = (value: WorkerOutcome) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    settle(value);
  };
  const timer = setTimeout(() => {
    if (settled) {
      return;
    }
    child.kill("SIGKILL");
    finish({
      kind: "timeout",
      errorExcerpt: `E2E soft-timeout ${timeoutMs}ms`,
    });
  }, timeoutMs);

  child.stdout?.on("data", (c: Buffer) => {
    stdout += c.toString();
  });
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString();
    process.stderr.write(c);
  });
  child.on("error", (error) => {
    finish({
      kind: "error",
      errorExcerpt: String(error),
    });
  });
  child.on("exit", () => {
    const lines = stdout.trim().split("\n").filter(Boolean);
    const last = lines.at(-1);
    if (!last) {
      finish({
        kind: "error",
        errorExcerpt: `no JSON from suite-worker\n${stderr.slice(-2000)}`,
      });
      return;
    }
    try {
      const parsed = JSON.parse(last) as SuiteWorkerResult;
      finish({ kind: "ok", result: parsed });
    } catch (error) {
      finish({
        kind: "error",
        errorExcerpt: `JSON parse failed: ${String(error)}`,
      });
    }
  });
  return promise;
}

function classifyAttempt(
  m: CatalogMutant,
  suite: {
    kind: "ok" | "timeout" | "error";
    result?: SuiteWorkerResult;
    errorExcerpt?: string;
  }
): Omit<
  AttemptRecord,
  "attemptNumber" | "startedAt" | "endedAt" | "durationMs"
> {
  if (suite.kind === "timeout") {
    return {
      result: "timeout",
      exitStatus: null,
      failedScenarioIds: [],
      errorExcerpt: suite.errorExcerpt ?? null,
    };
  }
  if (suite.kind === "error" || !suite.result) {
    return {
      result: "error",
      exitStatus: null,
      failedScenarioIds: [],
      errorExcerpt: suite.errorExcerpt ?? "unknown error",
    };
  }
  const failedNames = suite.result.browsers
    .flatMap((b) => b.cases)
    .filter((c) => c.status === "fail")
    .map((c) => c.name);
  const failedIds = failedNames
    .map((n) => scenarioIdByName(n))
    .filter((id): id is string => id !== null);
  const exitStatus = suite.result.status;
  if (exitStatus === "pass") {
    return {
      result: "survived",
      exitStatus: "pass",
      failedScenarioIds: [],
      errorExcerpt: null,
    };
  }
  const expected = new Set(m.expectedKillers);
  const hit = failedIds.filter((id) => expected.has(id));
  if (m.class === "control-survived") {
    // 対照群は expected 空。fail なら「想定外の検出」
    return {
      result: failedIds.length > 0 ? "killed" : "survived",
      exitStatus: "fail",
      failedScenarioIds: failedIds,
      errorExcerpt: null,
    };
  }
  if (hit.length > 0) {
    return {
      result: "killed",
      exitStatus: "fail",
      failedScenarioIds: failedIds,
      errorExcerpt: null,
    };
  }
  // unexpected-kill → survived + flag（呼び出し側で付与）
  return {
    result: "survived",
    exitStatus: "fail",
    failedScenarioIds: failedIds,
    errorExcerpt: null,
  };
}

async function runOneAttempt(
  m: CatalogMutant,
  runId: string,
  attemptNumber: number
): Promise<AttemptRecord> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let stack: Awaited<ReturnType<typeof startStack>> | undefined;
  try {
    assertCleanTree();
    applyMutant(m);
    stack = await startStack({
      runId,
      workerIndex: 0,
      dbLabel: m.id,
    });
    const suite = await runSuiteWorkerKillable(stack.env, E2E_TIMEOUT_MS);
    const classified = classifyAttempt(m, suite);
    return {
      attemptNumber,
      ...classified,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
  } catch (error) {
    return {
      attemptNumber,
      result: "error",
      exitStatus: null,
      failedScenarioIds: [],
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      errorExcerpt: String(error).slice(0, 2000),
    };
  } finally {
    try {
      restoreFile(m.file);
    } catch (error) {
      console.error(`restore failed for ${m.file}:`, error);
    }
    if (stack) {
      await stack.stop().catch(() => {});
    }
  }
}

async function mutantSuspectedCheck(
  m: CatalogMutant,
  runId: string
): Promise<"green" | "not-green"> {
  // 変異なしで同一手順（stack + e2e）を1回。attempts には入れない
  const stack = await startStack({
    runId: `${runId}-probe`,
    workerIndex: 0,
    dbLabel: `${m.id}-probe`,
  });
  try {
    const suite = await runSuiteWorkerKillable(stack.env, E2E_TIMEOUT_MS);
    if (suite.kind === "ok" && suite.result?.status === "pass") {
      return "green";
    }
    return "not-green";
  } finally {
    await stack.stop().catch(() => {});
  }
}

function buildReport(data: ResultsFile): string {
  const primary = data.mutants.filter((m) => m.class === "primary");
  const killed = primary.filter((m) => m.finalResult === "killed").length;
  const excluded = primary.filter((m) => m.excludedFromKillRate).length;
  const denom = PRIMARY_TOTAL - excluded;
  const rate = denom > 0 ? ((killed / denom) * 100).toFixed(1) : "n/a";
  const survived = primary.filter((m) => m.finalResult === "survived");
  const control = data.mutants.filter((m) => m.class === "control-survived");
  const infra = data.mutants.filter(
    (m) => m.finalResult === "timeout" || m.finalResult === "error"
  );
  const unexpected = data.mutants.filter((m) => m.unexpectedKill);
  const gap = survived.filter((m) => !m.unexpectedKill).length;
  const lines: string[] = [];
  lines.push("# E2E-oracle ミューテーションテスト結果");
  lines.push("");
  lines.push("## 1. 結論");
  lines.push("");
  lines.push(
    `kill rate は ${killed}/${denom} （${rate}%）でした。これはキュレーションカタログ（primary ${PRIMARY_TOTAL}件中、除外${excluded}件）に対する E2E oracle（Chromium・18シナリオ）の検出力の一指標であり、網羅的な変異テスト（Stryker等）の結果とは異なるため、この母集団を超えて一般化はできません。survived は${survived.length}件（意図的対照群${control.length}件の結果は別掲、テストギャップ候補${gap}件、unexpected-kill ${unexpected.length}件）です。`
  );
  lines.push("");
  lines.push("## 2. 実行条件");
  lines.push("");
  lines.push("| 項目 | 値 |");
  lines.push("|------|-----|");
  lines.push(`| runId | ${data.runId} |`);
  lines.push(`| gitShaBaseline | ${data.gitShaBaseline} |`);
  lines.push(`| catalogSha256 | ${data.catalogSha256} |`);
  lines.push(`| Node | ${data.nodeVersion} |`);
  lines.push(`| Playwright | ${data.playwrightVersion} |`);
  lines.push(`| Chromium | ${data.chromiumVersion} |`);
  lines.push(`| baseline | ${data.baselineResult} |`);
  lines.push(`| 所要時間 | ${(data.totalDurationMs / 1000).toFixed(1)}s |`);
  lines.push("");
  lines.push("## 3. 全mutant結果表");
  lines.push("");
  lines.push(
    "| id | class | file | result | expectedKillers | failed | unexpectedKill |"
  );
  lines.push(
    "|----|-------|------|--------|-----------------|--------|----------------|"
  );
  for (const m of data.mutants) {
    const last = m.attempts.at(-1);
    const failed = (last?.failedScenarioIds ?? []).join(",") || "-";
    lines.push(
      `| ${m.mutantId} | ${m.class} | ${m.file} | ${m.finalResult} | ${m.expectedKillers.join(",") || "-"} | ${failed} | ${m.unexpectedKill} |`
    );
  }
  lines.push("");
  lines.push("## 4. survived 分析（primary）");
  lines.push("");
  if (survived.length === 0) {
    lines.push("（なし）");
  } else {
    for (const m of survived) {
      const note = m.unexpectedKill
        ? `unexpected-kill（失敗: ${m.unexpectedFailedScenarioIds.join(",")}）。expectedKillers 設計または影響範囲の見直し候補。`
        : "意図外ギャップ候補、または等価変異疑い。観察のみ（改善しない）。";
      lines.push(`- **${m.mutantId}** (${m.operator}): ${note}`);
    }
  }
  lines.push("");
  lines.push("## 5. 対照群（control-survived）");
  lines.push("");
  for (const m of control) {
    lines.push(
      `- **${m.mutantId}**: finalResult=${m.finalResult}${m.finalResult === "killed" || m.unexpectedKill ? " ⚠️ 想定と反する" : "（想定どおり survived なら健全）"}`
    );
  }
  lines.push("");
  lines.push("## 6. infra-inconclusive");
  lines.push("");
  const suspected = infra.filter((m) =>
    (m.exclusionReason ?? "").startsWith("mutant-suspected:")
  );
  const plain = infra.filter(
    (m) => !(m.exclusionReason ?? "").startsWith("mutant-suspected:")
  );
  if (plain.length === 0 && suspected.length === 0) {
    lines.push("（なし）");
  }
  if (plain.length) {
    lines.push("### infra 起因が濃厚");
    for (const m of plain) {
      lines.push(
        `- ${m.mutantId}: ${m.finalResult} — ${m.exclusionReason ?? ""}`
      );
    }
  }
  if (suspected.length) {
    lines.push("### 検出相当の可能性あり（mutant-suspected）");
    for (const m of suspected) {
      lines.push(`- ${m.mutantId}: ${m.exclusionReason}`);
    }
  }
  lines.push("");
  lines.push("## 7. 再現手順");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run mutation");
  lines.push("```");
  lines.push("");
  lines.push(
    `カタログ: docs/mutation-catalog.json (sha256=${data.catalogSha256})`
  );
  lines.push(`生データ: docs/mutation-results.json`);
  lines.push("");
  lines.push("## 8. 観察のみの改善候補");
  lines.push("");
  lines.push(
    "本ランはコード・テストを改修しない。以下は観察メモであり、実施は別タスクとする。"
  );
  lines.push("");
  for (const m of survived) {
    lines.push(
      `- ${m.mutantId}: ${m.operator} が survived（ギャップまたは等価の可能性）`
    );
  }
  for (const m of control) {
    if (m.finalResult === "killed" || m.unexpectedKill) {
      lines.push(
        `- ${m.mutantId}: 対照群が検出された — E2E スコープ記述の更新を検討`
      );
    }
  }
  if (
    survived.length === 0 &&
    control.every((m) => m.finalResult === "survived")
  ) {
    lines.push("- 特記なし（primary はすべて killed、対照群は survived）");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runId = `mutation-${startedAt.replace(/[:.]/g, "-")}`;
  const filterIds = parseMutationIdsFilter();
  const filterMode = filterIds !== null;

  console.log("== mutation: clean check ==");
  assertCleanTree();

  console.log("== mutation: load catalog ==");
  const catalog = loadCatalog();
  const catalogSha256 = sha256File(CATALOG_PATH);
  console.log(`catalog sha256=${catalogSha256} count=${catalog.length}`);

  let mutantsToRun = catalog;
  if (filterMode) {
    const idSet = new Set(filterIds);
    const unknown = filterIds!.filter(
      (id) => !catalog.some((m) => m.id === id)
    );
    if (unknown.length > 0) {
      throw new Error(`未知の MUTATION_IDS: ${unknown.join(",")}`);
    }
    mutantsToRun = catalog.filter((m) => idSet.has(m.id));
    console.log(
      `MUTATION_IDS filter: ${mutantsToRun.map((m) => m.id).join(",")} (${mutantsToRun.length}件) — results/report は上書きしない`
    );
  }

  const require = createRequire(import.meta.url);
  const playwrightPkg = require("playwright/package.json") as {
    version: string;
  };

  console.log("== mutation: chromium version ==");
  const browser = await chromium.launch();
  const chromiumVersion = browser.version();
  await browser.close();

  const results: ResultsFile = {
    runId,
    gitShaBaseline: gitSha(),
    catalogSha256,
    nodeVersion: process.version,
    playwrightVersion: playwrightPkg.version,
    chromiumVersion,
    baselineResult: "aborted",
    startedAt,
    endedAt: startedAt,
    totalDurationMs: 0,
    mutants: [],
  };

  // resume: 既存 results があれば finalResult 済みをスキップ
  // フィルタ時は resume/既存 results マージをスキップ
  const doneIds = filterMode
    ? new Set<string>()
    : loadResumedMutants(catalogSha256, results);

  if (results.baselineResult !== "green") {
    console.log("== mutation: baseline ==");
    let baselineOk = false;
    for (let i = 1; i <= 2; i++) {
      const stack = await startStack({
        runId: `${runId}-baseline`,
        workerIndex: 0,
        dbLabel: `baseline-${i}`,
      });
      try {
        const suite = await runSuiteWorkerKillable(stack.env, E2E_TIMEOUT_MS);
        if (suite.kind === "ok" && suite.result?.status === "pass") {
          baselineOk = true;
          break;
        }
        console.error(
          `baseline attempt ${i} failed`,
          suite.errorExcerpt ?? suite.result?.status
        );
      } finally {
        await stack.stop();
      }
    }
    if (!baselineOk) {
      results.baselineResult = "aborted";
      results.endedAt = new Date().toISOString();
      results.totalDurationMs = Date.now() - t0;
      persistResults(results, filterMode);
      persistReport(results, filterMode);
      throw new Error("baseline が2回失敗したため中止（エスカレーション）");
    }
    results.baselineResult = "green";
    persistResults(results, filterMode);
  }

  for (const m of mutantsToRun) {
    if (doneIds.has(m.id)) {
      console.log(`skip ${m.id} (resume)`);
      continue;
    }
    console.log(`\n== mutant ${m.id} (${m.class}) ==`);
    assertCleanTree();

    const attempts: AttemptRecord[] = [];
    let final: AttemptRecord | undefined;
    for (let a = 1; a <= 1 + MAX_RETRIES; a++) {
      const attempt = await runOneAttempt(m, runId, a);
      attempts.push(attempt);
      console.log(
        `  attempt ${a}: ${attempt.result} failed=[${attempt.failedScenarioIds.join(",")}] ${attempt.durationMs}ms`
      );
      if (attempt.result === "killed" || attempt.result === "survived") {
        final = attempt;
        break;
      }
      if (a === 1 + MAX_RETRIES) {
        final = attempt;
      }
    }
    if (!final) {
      throw new Error("unreachable: no final attempt");
    }

    const unexpectedKill =
      final.result === "survived" &&
      final.exitStatus === "fail" &&
      final.failedScenarioIds.length > 0 &&
      m.class === "primary";

    let excludedFromKillRate = false;
    let exclusionReason: string | null = null;
    let finalResult: FinalResult = final.result;

    if (
      m.class === "primary" &&
      (final.result === "timeout" || final.result === "error")
    ) {
      excludedFromKillRate = true;
      exclusionReason = `infra-inconclusive:${final.result}`;
      console.log(`  probe mutant-suspected for ${m.id}...`);
      assertCleanTree();
      const probe = await mutantSuspectedCheck(m, runId);
      if (probe === "green") {
        exclusionReason = `mutant-suspected: green-after-restore`;
      }
    }

    if (
      m.class === "control-survived" &&
      (finalResult === "killed" ||
        finalResult === "timeout" ||
        finalResult === "error" ||
        unexpectedKill)
    ) {
      console.error(
        `ESCALATION: control-survived ${m.id} → ${finalResult} unexpectedKill=${unexpectedKill}`
      );
    }

    const record: MutantResult = {
      mutantId: m.id,
      file: m.file,
      operator: m.operator,
      class: m.class,
      expectedKillers: m.expectedKillers,
      attempts,
      finalResult,
      unexpectedKill,
      unexpectedFailedScenarioIds: unexpectedKill
        ? final.failedScenarioIds
        : [],
      excludedFromKillRate,
      exclusionReason,
    };
    results.mutants.push(record);
    console.log(`  finalResult: ${finalResult}`);
    results.endedAt = new Date().toISOString();
    results.totalDurationMs = Date.now() - t0;
    persistResults(results, filterMode);
    assertCleanTree();
  }

  results.endedAt = new Date().toISOString();
  results.totalDurationMs = Date.now() - t0;
  persistResults(results, filterMode);
  persistReport(results, filterMode);

  // bench dir cleanup
  const benchDir = path.join(ROOT, "data", `bench-${runId}`);
  const probeDir = path.join(ROOT, "data", `bench-${runId}-probe`);
  for (const d of [benchDir, probeDir]) {
    if (fs.existsSync(d)) {
      fs.rmSync(d, { recursive: true, force: true });
      console.log(`removed ${d}`);
    }
  }
  // baseline dirs
  const dataDir = path.join(ROOT, "data");
  if (fs.existsSync(dataDir)) {
    for (const name of fs.readdirSync(dataDir)) {
      if (name.startsWith(`bench-${runId}`)) {
        fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
      }
    }
  }

  assertCleanTree();

  if (filterMode) {
    console.log("\n== MUTATION_IDS filter summary ==");
    const ran = results.mutants.filter((m) =>
      mutantsToRun.some((c) => c.id === m.mutantId)
    );
    for (const m of ran) {
      console.log(`  ${m.mutantId}: finalResult=${m.finalResult}`);
    }
    const notKilled = ran.filter((m) => m.finalResult !== "killed");
    if (notKilled.length > 0) {
      console.error(
        `filter run: ${notKilled.length}/${ran.length} not killed → exit 1`
      );
      process.exit(1);
    }
    console.log(`filter run: all ${ran.length} killed`);
    return;
  }

  console.log(`\n== done == kill report → ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
