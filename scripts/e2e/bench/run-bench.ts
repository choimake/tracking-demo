// E2E 実行時間ベンチの CLI。
// 例:
//   npm run e2e:bench -- --cell serial-chromium --iterations 1
//   npm run e2e:bench -- --resume
import crypto from "node:crypto";

import type { BenchCell } from "./matrix.js";
import { BENCH_MATRIX, findCell } from "./matrix.js";
import { runParallelIteration } from "./parallel-runner.js";
import type { BenchReport, CellRunResult, IterationResult } from "./report.js";
import {
  buildReport,
  collectMeta,
  findLatestReport,
  readReport,
  writeReport,
} from "./report.js";
import { runSerialIteration } from "./serial-runner.js";

interface CliOptions {
  cellId: string | null;
  iterations: number;
  warmup: boolean;
  resume: boolean;
  runId: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    cellId: null,
    iterations: 1,
    warmup: true,
    resume: false,
    runId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cell" && argv[i + 1]) {
      opts.cellId = argv[++i];
    } else if (a === "--iterations" && argv[i + 1]) {
      opts.iterations = Number(argv[++i]);
      if (!Number.isFinite(opts.iterations) || opts.iterations < 1) {
        throw new Error("--iterations は 1 以上の整数である必要があります");
      }
    } else if (a === "--no-warmup") {
      opts.warmup = false;
    } else if (a === "--resume") {
      opts.resume = true;
    } else if (a === "--run-id" && argv[i + 1]) {
      opts.runId = argv[++i];
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知の引数: ${a}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Usage: npm run e2e:bench -- [options]

Options:
  --cell <id>         1セルだけ実行 (${BENCH_MATRIX.map((c) => c.id).join(", ")})
  --iterations <n>    計測イテレーション数 (default: 1)
  --no-warmup         ウォームアップ回をスキップ
  --resume            直近(または --run-id)の結果から未完了分を再開
  --run-id <id>       結果ファイルの runId を指定
`);
}

function newRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${crypto.randomBytes(3).toString("hex")}`;
}

function cellsToRun(cellId: string | null): BenchCell[] {
  if (!cellId) {
    return [...BENCH_MATRIX];
  }
  const cell = findCell(cellId);
  if (!cell) {
    throw new Error(
      `未知のセル: ${cellId} (候補: ${BENCH_MATRIX.map((c) => c.id).join(", ")})`
    );
  }
  return [cell];
}

function measuredCount(cell: CellRunResult): number {
  return cell.iterations.filter((it) => !it.warmup).length;
}

function hasWarmup(cell: CellRunResult): boolean {
  return cell.iterations.some((it) => it.warmup);
}

async function runIteration(
  cell: BenchCell,
  runId: string,
  iteration: number,
  warmup: boolean
): Promise<IterationResult> {
  console.log(
    `\n----- cell=${cell.id} mode=${cell.mode} iter=${iteration}${warmup ? " (warmup)" : ""} -----`
  );
  if (cell.mode === "serial") {
    return runSerialIteration({
      runId,
      browsers: cell.browsers,
      iteration,
      warmup,
    });
  }
  return runParallelIteration({
    runId,
    browsers: cell.browsers,
    iteration,
    warmup,
  });
}

function ensureCellResult(report: BenchReport, cell: BenchCell): CellRunResult {
  let existing = report.cells.find((c) => c.cellId === cell.id);
  if (!existing) {
    existing = {
      cellId: cell.id,
      mode: cell.mode,
      browsers: cell.browsers,
      iterations: [],
    };
    report.cells.push(existing);
  }
  return existing;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const targets = cellsToRun(opts.cellId);

  let report: BenchReport;
  if (opts.resume) {
    const prev = opts.runId ? readReport(opts.runId) : findLatestReport();
    if (!prev) {
      throw new Error("--resume したが再開可能な結果ファイルがありません");
    }
    report = prev;
    console.log(`resume runId=${report.meta.runId}`);
  } else {
    const runId = opts.runId ?? newRunId();
    const startedAt = new Date().toISOString();
    report = buildReport(collectMeta(runId, startedAt), []);
    console.log(`start runId=${runId}`);
  }

  for (const cell of targets) {
    const cellResult = ensureCellResult(report, cell);

    if (opts.warmup && !hasWarmup(cellResult)) {
      const warm = await runIteration(cell, report.meta.runId, 0, true);
      cellResult.iterations.push(warm);
      report = buildReport(report.meta, report.cells);
      const out = writeReport(report);
      console.log(`wrote ${out} (warmup ${cell.id} ${warm.status})`);
    }

    while (measuredCount(cellResult) < opts.iterations) {
      const iterNum = measuredCount(cellResult) + 1;
      const result = await runIteration(
        cell,
        report.meta.runId,
        iterNum,
        false
      );
      cellResult.iterations.push(result);
      report = buildReport(report.meta, report.cells);
      const out = writeReport(report);
      console.log(
        `wrote ${out} (${cell.id} iter=${iterNum} wall=${result.suite_wall_ms.toFixed(0)}ms ${result.status})`
      );
    }
  }

  report = buildReport(report.meta, report.cells);
  const out = writeReport(report);
  console.log(`\n===== bench done =====`);
  console.log(`report: ${out}`);
  for (const s of report.stats) {
    const wall = s.suite_wall_ms;
    console.log(
      `  ${s.cellId}: suite_wall mean=${wall.mean.toFixed(0)}ms median=${wall.median.toFixed(0)}ms n=${wall.n}`
    );
  }

  const anyFail = report.cells.some((c) =>
    c.iterations.some((it) => !it.warmup && it.status === "fail")
  );
  process.exit(anyFail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
