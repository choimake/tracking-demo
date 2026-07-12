import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startStack } from "./stack.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve(
  "@playwright/test/cli"
);
const DATA_DIR = path.join(ROOT, "data");

function stackDetails(output: string): {
  dbPath: string;
  ports: [number, number];
} {
  // stack起動ログのtracking port、site port、DB pathへマッチする。
  // 例: `tracking=http://localhost:3101 site=http://localhost:3201 db=/tmp/e2e.json`。
  const match = output.match(
    /tracking=http:\/\/localhost:(\d+) site=http:\/\/localhost:(\d+) db=(.+)\n/
  );
  assert.ok(match, `stack details not found: ${output}`);
  return { dbPath: match[3], ports: [Number(match[1]), Number(match[2])] };
}

async function assertPortsReleased(ports: number[]): Promise<void> {
  const released = await Promise.all(ports.map(listen));
  await Promise.all(released.map(close));
}

function runInjectedSuiteFailure(): Promise<{
  code: number | null;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SUITE_FAIL_IMMEDIATELY: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

function runInterruptedStartup(): Promise<{
  code: number | null;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test"], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let interrupted = false;
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
      if (!interrupted && output.includes("[E2E stack] starting")) {
        interrupted = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

function listen(port: number): Promise<net.Server> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function occupyIfAvailable(port: number): Promise<net.Server | null> {
  return listen(port).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") return null;
    throw error;
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const occupied = await Promise.all([
    occupyIfAvailable(3100),
    occupyIfAvailable(3200),
  ]);
  try {
    const results = await Promise.allSettled([
      startStack({ runId: "regression-first" }),
      startStack({ runId: "regression-second" }),
    ]);
    const handles = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    if (results.some((result) => result.status === "rejected")) {
      await Promise.all(handles.map((stack) => stack.stop()));
      throw results.find((result) => result.status === "rejected")?.reason;
    }
    assert.equal(handles.length, 2);
    const [first, second] = handles;
    try {
      assert.notEqual(first.env.PORT, second.env.PORT);
      assert.notEqual(first.env.SITE_PORT, second.env.SITE_PORT);
      assert.equal(
        new Set([
          first.env.PORT,
          first.env.SITE_PORT,
          second.env.PORT,
          second.env.SITE_PORT,
        ]).size,
        4
      );
      assert.notEqual(first.env.DB_PATH, second.env.DB_PATH);
      assert.notEqual(first.env.PORT, 3100);
      assert.notEqual(first.env.SITE_PORT, 3200);
      assert.ok(fs.existsSync(first.env.DB_PATH));
      assert.ok(fs.existsSync(second.env.DB_PATH));
      console.log(
        `parallel stacks: first=${first.env.PORT}/${first.env.SITE_PORT} ${first.env.DB_PATH}`
      );
      console.log(
        `parallel stacks: second=${second.env.PORT}/${second.env.SITE_PORT} ${second.env.DB_PATH}`
      );
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
    assert.equal(fs.existsSync(first.env.DB_PATH), false);
    assert.equal(fs.existsSync(second.env.DB_PATH), false);
    await assertPortsReleased([
      first.env.PORT,
      first.env.SITE_PORT,
      second.env.PORT,
      second.env.SITE_PORT,
    ]);

    let injectedDbPath = "";
    try {
      const stack = await startStack({ runId: "regression-failure" });
      injectedDbPath = stack.env.DB_PATH;
      try {
        throw new Error("意図的なテスト途中例外");
      } finally {
        await stack.stop();
      }
    } catch (error) {
      // テストが意図的に投げた例外へマッチする。例: `Error: 意図的なテスト途中例外`。
      assert.match(String(error), /意図的なテスト途中例外/);
    }
    assert.equal(fs.existsSync(injectedDbPath), false);
    console.log("failure cleanup: child stopped and run DB removed");

    let timeoutMessage = "";
    await assert.rejects(
      startStack({
        runId: "regression-timeout",
        startupTimeoutMs: 15_000,
        trackingHealthPath: "/missing-health-endpoint",
      }),
      (error: Error) => {
        timeoutMessage = error.message;
        // health check期限超過の診断へマッチする。例: `health timeout after 15000ms`。
        assert.match(error.message, /health timeout/);
        // 対象run IDの診断へマッチする。例: `runId=regression-timeout`。
        assert.match(error.message, /runId=regression-timeout/);
        // 動的portとDB pathの診断へマッチする。例: `PORT=3101 SITE_PORT=3201 DB_PATH=/tmp/e2e.json`。
        assert.match(error.message, /PORT=\d+ SITE_PORT=\d+ DB_PATH=/);
        // server出力の診断見出しへマッチする。例: `server output:`。
        assert.match(error.message, /server output:/);
        console.log(`startup diagnostic: ${error.message.split("\n")[0]}`);
        return true;
      }
    );
    // timeout診断のportとDB pathへマッチする。例: `PORT=3101 SITE_PORT=3201 DB_PATH=/tmp/e2e.json`。
    const timeoutMatch = timeoutMessage.match(
      /PORT=(\d+) SITE_PORT=(\d+) DB_PATH=(.+)\n/
    );
    assert.ok(timeoutMatch);
    assert.equal(fs.existsSync(timeoutMatch[3]), false);
    await assertPortsReleased([
      Number(timeoutMatch[1]),
      Number(timeoutMatch[2]),
    ]);

    const injectedRuns = await Promise.all([
      runInjectedSuiteFailure(),
      runInjectedSuiteFailure(),
    ]);
    const details = injectedRuns.map((injectedRun) => {
      assert.equal(injectedRun.code, 1);
      // 注入したsuite失敗の識別子へマッチする。例: `E2E_SUITE_FAIL_IMMEDIATELY`。
      assert.match(injectedRun.output, /E2E_SUITE_FAIL_IMMEDIATELY/);
      // stack cleanup完了ログへマッチする。例: `[E2E stack] cleanup complete`。
      assert.match(injectedRun.output, /\[E2E stack\] cleanup complete/);
      return stackDetails(injectedRun.output);
    });
    assert.notEqual(details[0].dbPath, details[1].dbPath);
    assert.equal(new Set(details.flatMap((detail) => detail.ports)).size, 4);
    for (const detail of details) {
      assert.equal(fs.existsSync(detail.dbPath), false);
    }
    await assertPortsReleased(details.flatMap((detail) => detail.ports));
    console.log(
      "parallel suite exceptions: processes stopped and run DBs removed"
    );

    const interruptedRun = await runInterruptedStartup();
    assert.equal(interruptedRun.code, 143);
    // SIGTERM後のstack cleanup完了ログへマッチする。例: `[E2E stack] cleanup complete`。
    assert.match(interruptedRun.output, /\[E2E stack\] cleanup complete/);
    const interruptedDetails = stackDetails(interruptedRun.output);
    assert.equal(fs.existsSync(interruptedDetails.dbPath), false);
    await assertPortsReleased(interruptedDetails.ports);
    console.log("startup signal: stack stopped and run DB removed");

    const stalePath = path.join(DATA_DIR, "e2e-regression-stale.tmp");
    const freshPath = path.join(DATA_DIR, "e2e-regression-fresh.tmp");
    fs.writeFileSync(stalePath, "stale");
    fs.writeFileSync(freshPath, "fresh");
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(stalePath, staleDate, staleDate);
    const ttlStack = await startStack({ runId: "regression-ttl" });
    await ttlStack.stop();
    assert.equal(fs.existsSync(stalePath), false);
    assert.equal(fs.existsSync(freshPath), true);
    fs.rmSync(freshPath, { force: true });
    console.log("TTL cleanup: stale removed and fresh retained");
  } finally {
    await Promise.all(
      occupied
        .filter((server): server is net.Server => server !== null)
        .map(close)
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
