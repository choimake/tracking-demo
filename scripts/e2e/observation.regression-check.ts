import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";

import { startStack, stackEnvRecord } from "./harness/stack.js";
import { TrackingClient } from "./tracking/client.js";

async function malformedOrigin(): Promise<{
  close: () => Promise<void>;
  origin: string;
}> {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        hits: [
          {
            eventId: null,
            id: 1,
            sid: "",
            test: false,
            ts: "2026-01-01T00:00:00.000Z",
            type: "pageview",
            ua: "regression",
            url: "/",
            vid: "",
            workspaceId: "ws-001",
          },
        ],
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function runObservationRegressionCheck(): Promise<void> {
  const disabled = await startStack({
    observationEnabled: false,
    runId: "observation-disabled",
  });
  try {
    const response = await fetch(
      `${disabled.env.TRACKING_ORIGIN}/api/e2e/observations/hits`
    );
    assert.equal(response.status, 404, "通常起動条件では観測APIを404にする");
    console.log("observation disabled contract: HTTP 404");
  } finally {
    await disabled.stop();
  }

  const enabled = await startStack({
    // 保存前検証では、collectからreadFileまでを10秒未満で実行する。
    dbSaveDebounceMs: 10_000,
    runId: "observation-enabled",
  });
  try {
    assert.equal(
      stackEnvRecord(enabled.env).E2E_OBSERVATION_ENABLED,
      "1",
      "suite-workerへ観測APIの起動条件を渡す"
    );
    const correlationId = "observation-contract/chromium/0";
    const ua = `regression td-e2e/${correlationId}`;
    const url = "/observation-before-flush";
    const collectResponse = await fetch(
      `${enabled.env.TRACKING_ORIGIN}/api/collect`,
      {
        body: JSON.stringify({
          sid: "",
          type: "pageview",
          ua,
          url,
          vid: "",
          ws: "ws-001",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    assert.equal(collectResponse.status, 201);

    const tracking = new TrackingClient(
      correlationId,
      enabled.env.TRACKING_ORIGIN
    );
    const observed = await tracking.getHitsMatching({ type: "pageview" });
    assert.equal(observed.length, 1);
    assert.equal(observed[0].url, url);
    const fileBeforeFlush = await fs.readFile(enabled.env.DB_PATH, "utf8");
    assert.equal(
      fileBeforeFlush.includes(url),
      false,
      "ファイル保存前のHitを観測APIから取得する"
    );
    console.log("observation immediate contract: observed before DB flush");

    await assert.rejects(
      tracking.getEventCount7dFromApi("ev_missing"),
      /イベントが管理API応答に存在しません: eventId=ev_missing/
    );
    console.log("missing event contract: diagnostic failure");
  } finally {
    await enabled.stop();
  }

  const malformed = await malformedOrigin();
  try {
    const tracking = new TrackingClient(undefined, malformed.origin);
    await assert.rejects(
      tracking.getAllHits(),
      /観測API応答が不正です: hits\[0\]\.id がstringではありません/
    );
    console.log("malformed observation contract: diagnostic failure");
  } finally {
    await malformed.close();
  }

  console.log("observation regression check: PASS");
}

await runObservationRegressionCheck();
