import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { request as nodeRequest } from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import express from "express";

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "boundary-contract-")
);
process.env.DB_PATH = path.join(temporaryDirectory, "db.json");
process.env.DB_SAVE_DEBOUNCE_MS = "0";
process.env.E2E_OBSERVATION_ENABLED = "1";
process.env.PORT = "3100";

const boundary = await import("../src/index.js");

const logged: unknown[][] = [];
const originalConsoleError = console.error;
console.error = (...values: unknown[]) => {
  logged.push(values);
};

const app = boundary.createTrackingApp({
  collectFetch: async () => {
    throw new Error("injected upstream secret");
  },
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;

const unexpectedApp = express();
unexpectedApp.get("/unexpected", () => {
  throw new Error("unexpected HTTP secret");
});
unexpectedApp.get("/spoofed", () => {
  throw { kind: "application" };
});
unexpectedApp.use(boundary.boundaryErrorMiddleware);
const unexpectedServer = unexpectedApp.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  unexpectedServer.once("listening", resolve);
  unexpectedServer.once("error", reject);
});
const unexpectedAddress = unexpectedServer.address();
assert(unexpectedAddress && typeof unexpectedAddress !== "string");
const unexpectedOrigin = `http://127.0.0.1:${unexpectedAddress.port}`;

function closeServer(target: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    target.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function requestWithHost(host: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const outgoing = nodeRequest(
      `${origin}/api/workspace`,
      { headers: { Host: host } },
      (incoming) => {
        incoming.resume();
        incoming.once("end", () => resolve(incoming.statusCode ?? 0));
      }
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

async function request(
  pathname: string,
  options: RequestInit = {}
): Promise<{ body: Record<string, unknown>; status: number }> {
  const response = await fetch(`${origin}${pathname}`, options);
  return {
    body: (await response.json()) as Record<string, unknown>,
    status: response.status,
  };
}

async function jsonRequest(
  method: string,
  pathname: string,
  body: unknown
): ReturnType<typeof request> {
  return request(pathname, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

try {
  const malformed = await request("/api/collect", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.deepEqual(malformed, {
    body: { code: "invalid_json", error: "invalid JSON" },
    status: 400,
  });

  const oversized = await request("/api/collect", {
    body: JSON.stringify({ padding: "x".repeat(110_000) }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.deepEqual(oversized, {
    body: { code: "payload_too_large", error: "payload too large" },
    status: 413,
  });

  const before = await request("/api/e2e/observations/hits");
  const beforeHits = before.body.hits as unknown[];
  for (const invalidBody of [
    {},
    { type: "other", ws: "ws-001" },
    { type: "pageview", url: 1, ws: "ws-001" },
    { eventId: 1, type: "event", ws: "ws-001" },
    { type: "pageview", ua: "x".repeat(513), ws: "ws-001" },
    { type: "pageview", vid: "invalid", ws: "ws-001" },
    { sid: "invalid", type: "pageview", ws: "ws-001" },
    { type: "event", ws: "ws-001" },
    { test: "true", type: "pageview", ws: "ws-001" },
  ]) {
    const response = await jsonRequest("POST", "/api/collect", invalidBody);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "invalid_input");
  }
  const after = await request("/api/e2e/observations/hits");
  assert.equal((after.body.hits as unknown[]).length, beforeHits.length);

  assert.equal((await request("/api/config?id=unknown")).status, 404);
  assert.equal(
    (await jsonRequest("PUT", "/api/workspace", { name: " " })).status,
    400
  );
  for (const invalidHost of [
    "attacker@example.test",
    `x';alert(1);'`,
    'x";alert(1);"',
  ]) {
    assert.equal(await requestWithHost(invalidHost), 400);
  }
  assert.equal(
    (await jsonRequest("PUT", "/api/workspace", { name: 123 })).status,
    400
  );
  assert.equal(
    (
      await jsonRequest("POST", "/api/events", {
        name: "invalid",
        trigger: "time_on_page:0",
      })
    ).status,
    400
  );
  assert.equal(
    (
      await jsonRequest("POST", "/api/events", {
        name: "invalid",
        trigger: 123,
      })
    ).status,
    400
  );
  assert.equal(
    (
      await jsonRequest("POST", "/api/events/ev_purchase/toggle", {
        enabled: "true",
      })
    ).status,
    400
  );
  assert.equal((await request("/api/tag-check?since=nope")).status, 400);
  assert.equal(
    (
      await jsonRequest("POST", "/api/labels", {
        color: "red",
        name: "invalid",
      })
    ).status,
    400
  );
  assert.equal(
    (
      await jsonRequest("PUT", "/api/events/ev_missing", {
        name: "missing",
        trigger: "exit_intent",
      })
    ).status,
    404
  );
  assert.equal(
    (await request("/api/labels/not-an-id", { method: "DELETE" })).status,
    400
  );

  const transport = await jsonRequest(
    "POST",
    "/api/events/ev_purchase/test",
    {}
  );
  assert.deepEqual(transport, {
    body: {
      code: "collect_transport_failure",
      error: "collect request failed",
    },
    status: 502,
  });
  assert(logged.some((entry) => String(entry[0]).includes("transport")));

  for (const pathname of ["/unexpected", "/spoofed"]) {
    const response = await fetch(`${unexpectedOrigin}${pathname}`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      code: "unexpected_error",
      error: "internal server error",
    });
  }
  assert(logged.some((entry) => String(entry[0]).includes("unexpected")));

  const unexpected = boundary.classifyBoundaryError(
    new Error("unexpected secret")
  );
  assert.deepEqual(
    {
      code: unexpected.code,
      kind: unexpected.kind,
      message: unexpected.message,
      status: unexpected.status,
    },
    {
      code: "unexpected_error",
      kind: "unexpected",
      message: "internal server error",
      status: 500,
    }
  );

  // contract-id: TRACKER-CONFIG-SHAPE
  assert.deepEqual(
    boundary.parseTrackerConfig({
      events: [{ id: "ev_valid", name: "valid", trigger: "exit_intent" }],
    }),
    [{ id: "ev_valid", name: "valid", trigger: "exit_intent" }]
  );
  for (const invalidConfig of [
    null,
    {},
    { events: {} },
    { events: [{ id: 1, name: "invalid", trigger: "exit_intent" }] },
    { events: [{ id: "ev_invalid", trigger: "exit_intent" }] },
  ]) {
    assert.equal(boundary.parseTrackerConfig(invalidConfig), null);
  }

  assert.equal(boundary.validatePersistedDatabase(null).ok, false);
  const repaired = boundary.validatePersistedDatabase({
    events: [
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "ev_legacy",
        updatedAt: "2026-01-01T00:00:00.000Z",
        workspaceId: "ws-001",
      },
    ],
    hits: [],
    labels: [{ id: "lb_legacy" }],
    workspace: {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "ws-001",
      name: "legacy",
    },
  });
  assert(repaired.ok);
  assert.deepEqual(repaired.value.events[0].labelIds, []);
  assert.equal(repaired.value.labels[0].color, "#8b8d98");

  // contract-id: PERSISTENCE-LOAD-RECOVERY
  const corruptDatabase = path.join(temporaryDirectory, "corrupt.json");
  fs.writeFileSync(corruptDatabase, "{");
  const databaseModule = pathToFileURL(path.resolve("src/db.ts")).href;
  const recovery = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(databaseModule)})`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, DB_PATH: corruptDatabase },
    }
  );
  assert.equal(recovery.status, 0, recovery.stderr);
  assert(fs.existsSync(`${corruptDatabase}.bak`));
  assert(
    boundary.validatePersistedDatabase(
      JSON.parse(fs.readFileSync(corruptDatabase, "utf8"))
    ).ok
  );

  assert.equal(
    boundary.validateEnvironmentForContract({ PORT: "invalid" }).ok,
    false
  );
  assert.throws(() =>
    boundary.loadDemoServerEnvironment({ TRACKING_ORIGIN: "file:///tmp" })
  );
  assert.throws(() =>
    boundary.loadDatabaseEnvironment("/tmp", {
      DB_SAVE_DEBOUNCE_MS: "-1",
    })
  );
} finally {
  console.error = originalConsoleError;
  await Promise.all([closeServer(server), closeServer(unexpectedServer)]);
  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
}

console.log(
  "Boundary contract check: OK (HTTP invalid input, persistence/environment validation, error propagation)"
);
