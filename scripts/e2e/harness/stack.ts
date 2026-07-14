import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_WAIT_TIMEOUT_MS,
  registeredAbortSignal,
  registeredWait,
} from "./config.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const DATA_DIR = path.join(ROOT, "data");
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const STARTUP_TIMEOUT_MS = 30_000;
const PORT_BIND_RETRY_COUNT = 3;

/** cleanup が完了しなかった run 専用 DB を次回起動時に回収する期限 */
export const E2E_DATA_TTL_MS = 24 * 60 * 60 * 1000;

export interface StackEnv {
  PORT: number;
  SITE_PORT: number;
  DB_PATH: string;
  DB_SAVE_DEBOUNCE_MS?: number;
  E2E_OBSERVATION_ENABLED: "0" | "1";
  TRACKING_ORIGIN: string;
  DEMO_SITE_URL: string;
}

export interface StartStackOptions {
  runId?: string;
  /** 呼び出し元の論理ワーカー番号。動的ポート採番では識別情報としてのみ使う。 */
  workerIndex?: number;
  /** DB ファイル名に使うラベル */
  dbLabel?: string;
  /** true の場合はサーバー出力を親へ転送する */
  forwardOutput?: boolean;
  /** 起動待機の上限。未指定時は30秒 */
  startupTimeoutMs?: number;
  /** tracking の起動確認パス。故障診断テストで上書きできる。 */
  trackingHealthPath?: string;
  /** falseの場合は観測APIを登録しない。通常E2Eではtrue。 */
  observationEnabled?: boolean;
  /** 観測APIの保存前回帰テストでのみ上書きする。 */
  dbSaveDebounceMs?: number;
  /** 指定時はサーバーの標準出力と標準エラーを診断ログへ複製する。 */
  logPath?: string;
}

export interface StackHandle {
  env: StackEnv;
  pid: number | undefined;
  runId: string;
  stop: () => Promise<void>;
}

interface PortReservation {
  port: number;
  release: () => Promise<void>;
}

function safeLabel(value: string): string {
  // 英数字、`_`、`-` 以外の文字へマッチする。例: `run/01` の `/`。
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function cleanupStaleData(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const expiresBefore = Date.now() - E2E_DATA_TTL_MS;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.startsWith("e2e-") || !name.includes(".tmp")) {
      continue;
    }
    const target = path.join(DATA_DIR, name);
    try {
      if (fs.statSync(target).mtimeMs < expiresBefore) {
        fs.rmSync(target, { force: true });
      }
    } catch (error) {
      console.error(
        `期限切れ E2E データの回収に失敗: ${target}: ${String(error)}`
      );
    }
  }
}

async function reservePort(): Promise<PortReservation> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("動的ポートを取得できませんでした");
  }
  return {
    port: address.port,
    release: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function buildEnv(
  runId: string,
  dbLabel: string,
  options: StartStackOptions
): Promise<StackEnv> {
  cleanupStaleData();
  const tracking = await reservePort();
  const site = await reservePort();
  try {
    const DB_PATH = path.join(
      DATA_DIR,
      `e2e-${safeLabel(runId)}-${safeLabel(dbLabel)}-${crypto.randomBytes(3).toString("hex")}.tmp`
    );
    fs.rmSync(DB_PATH, { force: true });
    return {
      PORT: tracking.port,
      SITE_PORT: site.port,
      DB_PATH,
      ...(options.dbSaveDebounceMs === undefined
        ? {}
        : { DB_SAVE_DEBOUNCE_MS: options.dbSaveDebounceMs }),
      E2E_OBSERVATION_ENABLED: options.observationEnabled === false ? "0" : "1",
      TRACKING_ORIGIN: `http://localhost:${tracking.port}`,
      DEMO_SITE_URL: `http://localhost:${site.port}`,
    };
  } finally {
    await Promise.all([tracking.release(), site.release()]);
  }
}

function appendOutput(current: string, chunk: Buffer): string {
  const combined = current + chunk.toString();
  return combined.length > 64_000 ? combined.slice(-64_000) : combined;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError: unknown = new Error("未接続");
  while (Date.now() - started < timeoutMs) {
    try {
      const remainingMs = Math.max(0, timeoutMs - (Date.now() - started));
      const response = await fetch(url, {
        signal: registeredAbortSignal(
          "stack-health-request-deadline",
          Math.min(DEFAULT_WAIT_TIMEOUT_MS, remainingMs)
        ),
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await registeredWait(
      "stack-health-poll",
      Math.min(200, Math.max(0, timeoutMs - (Date.now() - started)))
    );
  }
  throw new Error(`health timeout: ${url}; last=${String(lastError)}`);
}

export function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    if (child.exitCode !== null || child.signalCode !== null) resolve();
  });
  signalChild(child, "SIGTERM");
  const stoppedAfterTerm = await Promise.race([
    exited.then(() => true),
    registeredWait("stack-stop-term-deadline").then(() => false as const),
  ]);
  if (stoppedAfterTerm) {
    return;
  }
  signalChild(child, "SIGKILL");
  const stoppedAfterKill = await Promise.race([
    exited.then(() => true),
    registeredWait("stack-stop-kill-deadline").then(() => false as const),
  ]);
  if (!stoppedAfterKill) {
    throw new Error(
      `E2E stack停止待ちがtimeout: condition=SIGKILL後にchild exit eventを受信; finalObserved=${JSON.stringify({ exitCode: child.exitCode, pid: child.pid, signalCode: child.signalCode })}`
    );
  }
}

function cleanupOwnedData(dbPath: string): void {
  for (const target of [dbPath, `${dbPath}.tmp`, `${dbPath}.bak`]) {
    fs.rmSync(target, { force: true });
  }
}

/** 動的ポートと run 専用 DB でアプリを起動し、両サーバーの応答を待つ。 */
async function startStackAttempt(
  runId: string,
  options: StartStackOptions = {}
): Promise<StackHandle> {
  const workerLabel =
    options.workerIndex === undefined
      ? (options.dbLabel ?? "suite")
      : `${options.dbLabel ?? "suite"}-${options.workerIndex}`;
  const env = await buildEnv(runId, workerLabel, options);
  const child = spawn(process.execPath, [TSX_CLI, "src/main.ts"], {
    cwd: ROOT,
    detached: process.platform !== "win32",
    env: { ...process.env, ...stackEnvRecord(env) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const appendLog = (chunk: Buffer): void => {
    if (options.logPath) fs.appendFileSync(options.logPath, chunk);
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    output = appendOutput(output, chunk);
    appendLog(chunk);
    if (options.forwardOutput) process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output = appendOutput(output, chunk);
    appendLog(chunk);
    if (options.forwardOutput) process.stderr.write(chunk);
  });

  const earlyExit = new Promise<never>((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(new Error(`stack early exit: code=${code} signal=${signal}`));
    });
  });
  const health = Promise.all([
    waitForHealth(
      `${env.TRACKING_ORIGIN}${options.trackingHealthPath ?? "/tracker.js?id=ws-001"}`,
      options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS
    ),
    waitForHealth(
      `${env.DEMO_SITE_URL}/`,
      options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS
    ),
  ]);

  try {
    await Promise.race([health, earlyExit]);
  } catch (error) {
    await stopChild(child).catch(() => {});
    cleanupOwnedData(env.DB_PATH);
    throw new Error(
      `E2E stack startup failed: ${String(error)}\n` +
        `runId=${runId} PORT=${env.PORT} SITE_PORT=${env.SITE_PORT} DB_PATH=${env.DB_PATH}\n` +
        `server output:\n${output || "(none)"}`,
      { cause: error }
    );
  }

  let stopPromise: Promise<void> | undefined;
  return {
    env,
    pid: child.pid,
    runId,
    stop: async () => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        let stopError: unknown;
        try {
          await stopChild(child);
        } catch (error) {
          stopError = error;
        }
        try {
          cleanupOwnedData(env.DB_PATH);
        } catch (error) {
          console.error(
            `E2E データの削除に失敗しました。24時間後の起動時回収対象です: ${env.DB_PATH}: ${String(error)}`
          );
        }
        if (stopError) throw stopError;
      })();
      try {
        await stopPromise;
      } catch (error) {
        stopPromise = undefined;
        throw error;
      }
    },
  };
}

/** ポート取得競合時は新しい動的ポートで再試行する。 */
export async function startStack(
  options: StartStackOptions = {}
): Promise<StackHandle> {
  const runId = options.runId ?? crypto.randomUUID();
  let lastError: unknown;
  for (let attempt = 1; attempt <= PORT_BIND_RETRY_COUNT; attempt++) {
    try {
      return await startStackAttempt(runId, options);
    } catch (error) {
      lastError = error;
      if (!String(error).includes("EADDRINUSE")) throw error;
    }
  }
  throw new Error(
    `E2E stack port allocation failed after ${PORT_BIND_RETRY_COUNT} attempts`,
    { cause: lastError }
  );
}

export function stackEnvRecord(env: StackEnv): NodeJS.ProcessEnv {
  return {
    PORT: String(env.PORT),
    SITE_PORT: String(env.SITE_PORT),
    DB_PATH: env.DB_PATH,
    DB_SAVE_DEBOUNCE_MS:
      env.DB_SAVE_DEBOUNCE_MS === undefined
        ? undefined
        : String(env.DB_SAVE_DEBOUNCE_MS),
    E2E_OBSERVATION_ENABLED: env.E2E_OBSERVATION_ENABLED,
    TRACKING_ORIGIN: env.TRACKING_ORIGIN,
    DEMO_SITE_URL: env.DEMO_SITE_URL,
  };
}
