import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BrowserName } from "../harness/config.js";
import type { BenchMode } from "./matrix.js";
import type { NumericStats } from "./stats.js";
import { computeStats } from "./stats.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

export type CaseStatus = "pass" | "fail";

export interface CaseTiming {
  name: string;
  browser: BrowserName;
  case_ms: number;
  status: CaseStatus;
  error?: string;
}

export interface BrowserTiming {
  browser: BrowserName;
  browser_ms: number;
  status: CaseStatus;
  cases: CaseTiming[];
}

export interface IterationResult {
  iteration: number;
  warmup: boolean;
  suite_wall_ms: number;
  status: CaseStatus;
  browsers: BrowserTiming[];
}

export interface CellRunResult {
  cellId: string;
  mode: BenchMode;
  browsers: BrowserName[];
  iterations: IterationResult[];
}

export interface BenchMeta {
  os: string;
  cpus: number;
  node: string;
  playwright: string;
  gitSha: string;
  startedAt: string;
  runId: string;
}

export interface CellStats {
  cellId: string;
  suite_wall_ms: NumericStats;
  browser_ms: Record<string, NumericStats>;
  case_ms: Record<string, NumericStats>;
}

export interface BenchReport {
  meta: BenchMeta;
  cells: CellRunResult[];
  stats: CellStats[];
}

const require = createRequire(import.meta.url);

export function resultsDir(): string {
  return path.join(ROOT, "scripts/e2e/bench/results");
}

export function reportPath(runId: string): string {
  return path.join(resultsDir(), `bench-${runId}.json`);
}

export function collectMeta(runId: string, startedAt: string): BenchMeta {
  let gitSha = "unknown";
  try {
    gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    // git が使えない環境では unknown のまま
  }
  let playwright = "unknown";
  try {
    playwright = (require("playwright/package.json") as { version: string })
      .version;
  } catch {
    // ignore
  }
  return {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpus: os.cpus().length,
    node: process.version,
    playwright,
    gitSha,
    startedAt,
    runId,
  };
}

function aggregateCellStats(cell: CellRunResult): CellStats {
  const measured = cell.iterations.filter((it) => !it.warmup);
  const suiteWall = measured.map((it) => it.suite_wall_ms);
  const browserMs: Record<string, number[]> = {};
  const caseMs: Record<string, number[]> = {};
  for (const it of measured) {
    for (const b of it.browsers) {
      (browserMs[b.browser] ??= []).push(b.browser_ms);
      for (const c of b.cases) {
        const key = `${b.browser}::${c.name}`;
        (caseMs[key] ??= []).push(c.case_ms);
      }
    }
  }
  return {
    cellId: cell.cellId,
    suite_wall_ms: computeStats(suiteWall),
    browser_ms: Object.fromEntries(
      Object.entries(browserMs).map(([k, v]) => [k, computeStats(v)])
    ),
    case_ms: Object.fromEntries(
      Object.entries(caseMs).map(([k, v]) => [k, computeStats(v)])
    ),
  };
}

export function buildReport(
  meta: BenchMeta,
  cells: CellRunResult[]
): BenchReport {
  return {
    meta,
    cells,
    stats: cells.map(aggregateCellStats),
  };
}

export function writeReport(report: BenchReport): string {
  const dir = resultsDir();
  fs.mkdirSync(dir, { recursive: true });
  const out = reportPath(report.meta.runId);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  return out;
}

export function readReport(runId: string): BenchReport | null {
  const p = reportPath(runId);
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as BenchReport;
}

/** results 配下の最新 bench-*.json を探す(resume 用) */
export function findLatestReport(): BenchReport | null {
  const dir = resultsDir();
  if (!fs.existsSync(dir)) {
    return null;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("bench-") && f.endsWith(".json"))
    .map((f) => ({
      f,
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }));
  // oxlint-disable-next-line unicorn/no-array-sort -- tsconfig lib は ES2022(toSorted なし)
  files.sort((a, b) => b.mtime - a.mtime);
  const [latestFile] = files;
  if (latestFile === undefined) {
    return null;
  }
  return JSON.parse(
    fs.readFileSync(path.join(dir, latestFile.f), "utf8")
  ) as BenchReport;
}
