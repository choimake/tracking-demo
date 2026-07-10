import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** tracking 3310+i / site 3320+i */
export const TRACKING_PORT_BASE = 3310;
export const SITE_PORT_BASE = 3320;

export interface StackEnv {
  PORT: number;
  SITE_PORT: number;
  DB_PATH: string;
  TRACKING_ORIGIN: string;
  DEMO_SITE_URL: string;
}

export interface StartStackOptions {
  runId: string;
  /** ワーカー番号(ポートオフセット) */
  workerIndex: number;
  /** DB ファイル名に使うラベル(browser 名 or serial) */
  dbLabel: string;
}

export interface StackHandle {
  env: StackEnv;
  stop: () => Promise<void>;
}

function buildEnv(opts: StartStackOptions): StackEnv {
  const PORT = TRACKING_PORT_BASE + opts.workerIndex;
  const SITE_PORT = SITE_PORT_BASE + opts.workerIndex;
  const dbDir = path.join(ROOT, "data", `bench-${opts.runId}`);
  fs.mkdirSync(dbDir, { recursive: true });
  const DB_PATH = path.join(dbDir, `db-${opts.dbLabel}.json`);
  // 既存 DB が残っているとシードをスキップするため、起動前に消す
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
  return {
    PORT,
    SITE_PORT,
    DB_PATH,
    TRACKING_ORIGIN: `http://localhost:${PORT}`,
    DEMO_SITE_URL: `http://localhost:${SITE_PORT}`,
  };
}

async function waitForHealth(origin: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${origin}/tracker.js?id=ws-001`);
      if (res.ok) {
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `スタックのヘルスチェックがタイムアウト: ${origin} (${String(lastError)})`
  );
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => {
    child.kill("SIGKILL");
  }, 5000);
  try {
    await exited;
  } finally {
    clearTimeout(killTimer);
  }
}

/** 子プロセスで `tsx src/main.ts` を起動し、ヘルスチェック後にハンドルを返す */
export async function startStack(
  opts: StartStackOptions
): Promise<StackHandle> {
  const env = buildEnv(opts);
  const child = spawn("npx", ["tsx", "src/main.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(env.PORT),
      SITE_PORT: String(env.SITE_PORT),
      DB_PATH: env.DB_PATH,
      TRACKING_ORIGIN: env.TRACKING_ORIGIN,
      DEMO_SITE_URL: env.DEMO_SITE_URL,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", (_chunk: Buffer) => {
    // 起動ログは捨てる(ベンチ出力を汚さない)
  });

  let startupDone = false;
  const earlyExit = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) => {
      if (!startupDone) {
        reject(
          new Error(
            `スタックが早期終了 code=${code} signal=${signal}\n${stderr}`
          )
        );
      }
    });
  });

  try {
    await Promise.race([waitForHealth(env.TRACKING_ORIGIN, 30_000), earlyExit]);
    // デモサイトは HTML を返すので / で確認
    const siteStarted = Date.now();
    let siteOk = false;
    while (Date.now() - siteStarted < 10_000) {
      try {
        const siteRes = await fetch(`${env.DEMO_SITE_URL}/`);
        if (siteRes.ok) {
          siteOk = true;
          break;
        }
      } catch {
        // 起動待ち
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!siteOk) {
      throw new Error(
        `デモサイトのヘルスチェックがタイムアウト: ${env.DEMO_SITE_URL}`
      );
    }
    startupDone = true;
  } catch (error) {
    startupDone = true;
    await stopChild(child);
    throw error;
  }

  return {
    env,
    stop: async () => {
      await stopChild(child);
    },
  };
}

export function stackEnvRecord(env: StackEnv): NodeJS.ProcessEnv {
  return {
    PORT: String(env.PORT),
    SITE_PORT: String(env.SITE_PORT),
    DB_PATH: env.DB_PATH,
    TRACKING_ORIGIN: env.TRACKING_ORIGIN,
    DEMO_SITE_URL: env.DEMO_SITE_URL,
  };
}
