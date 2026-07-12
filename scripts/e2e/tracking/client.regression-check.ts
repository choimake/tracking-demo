import assert from "node:assert/strict";
import http from "node:http";

import { TrackingClient } from "./client.js";

type ResponseMode =
  | "create-schema"
  | "delete-schema"
  | "events-schema"
  | "hang"
  | "malformed"
  | "tag-check-schema"
  | "tag-check-valid"
  | "toggle-schema";

const REQUEST_TIMEOUT_MS = 50;

async function startContractServer(): Promise<{
  close: () => Promise<void>;
  origin: string;
  setMode: (mode: ResponseMode) => void;
}> {
  let mode: ResponseMode = "malformed";
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    switch (mode) {
      case "hang":
        response.flushHeaders();
        return;
      case "malformed":
        response.end("{");
        return;
      case "tag-check-schema":
        response.end(JSON.stringify({ count: 0 }));
        return;
      case "tag-check-valid":
        response.end(
          JSON.stringify({
            count: 1,
            hits: [
              {
                eventId: null,
                id: "hit_01",
                sid: "s_123e4567-e89b-12d3-a456-426614174000",
                test: false,
                ts: "2026-01-01T00:00:00.000Z",
                type: "pageview",
                ua: "regression",
                url: "/",
                vid: "v_123e4567-e89b-12d3-a456-426614174000",
                workspaceId: "ws-001",
              },
            ],
          })
        );
        return;
      case "events-schema":
        response.end(
          JSON.stringify({
            events: [{ count7d: 0, id: "ev_01", name: "購入" }],
          })
        );
        return;
      case "create-schema":
      case "toggle-schema":
        response.end(JSON.stringify({ event: { id: "ev_01" } }));
        return;
      case "delete-schema":
        response.end(JSON.stringify({ ok: false }));
        return;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    origin: `http://127.0.0.1:${address.port}`,
    setMode: (nextMode) => {
      mode = nextMode;
    },
  };
}

function hasMessage(...parts: string[]): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof Error &&
    parts.every((part) => error.message.includes(part));
}

export async function runClientRegressionCheck(): Promise<void> {
  const server = await startContractServer();
  const tracking = new TrackingClient(
    undefined,
    server.origin,
    REQUEST_TIMEOUT_MS
  );
  try {
    server.setMode("malformed");
    await assert.rejects(
      tracking.getTagCheck(0),
      hasMessage(
        "GET /api/tag-check?since=0 のJSONが不正です",
        "expected=valid JSON",
        'actual="{"'
      ),
      "malformed JSONはmethod、path、実際値、期待値を含めて失敗する"
    );

    server.setMode("tag-check-schema");
    await assert.rejects(
      tracking.getTagCheck(0),
      hasMessage(
        "管理API /api/tag-check応答が不正です: hits",
        "expected=array",
        "actual=undefined"
      ),
      "tag-checkのschema欠落はフィールド、実際値、期待値を含めて失敗する"
    );

    server.setMode("tag-check-valid");
    assert.deepEqual(await tracking.getTagCheck(0), {
      count: 1,
      hits: [
        {
          eventId: null,
          id: "hit_01",
          sid: "s_123e4567-e89b-12d3-a456-426614174000",
          test: false,
          ts: "2026-01-01T00:00:00.000Z",
          type: "pageview",
          ua: "regression",
          url: "/",
          vid: "v_123e4567-e89b-12d3-a456-426614174000",
          workspaceId: "ws-001",
        },
      ],
    });

    server.setMode("events-schema");
    await assert.rejects(
      tracking.getEventSummaries(),
      hasMessage("events[0].enabled", "expected=boolean", "actual=undefined"),
      "event summaryのschema欠落を失敗させる"
    );

    server.setMode("create-schema");
    await assert.rejects(
      tracking.createEvent({
        description: "",
        labelIds: [],
        name: "購入",
        trigger: "click:#buy",
      }),
      hasMessage("count7d", "expected=finite number", "actual=undefined"),
      "createEventの応答schema欠落を失敗させる"
    );

    server.setMode("toggle-schema");
    await assert.rejects(
      tracking.toggleEvent("ev_01", true),
      hasMessage("count7d", "expected=finite number", "actual=undefined"),
      "toggleEventの応答schema欠落を失敗させる"
    );

    server.setMode("delete-schema");
    await assert.rejects(
      tracking.deleteEvent("ev_01"),
      hasMessage("expected=true", "actual=false"),
      "deleteEventの応答schema不一致を失敗させる"
    );

    server.setMode("hang");
    await assert.rejects(
      tracking.getTagCheck(0),
      hasMessage(
        "GET /api/tag-check?since=0 が timeout",
        `expected=${REQUEST_TIMEOUT_MS}ms以内のHTTP応答`,
        "actual=応答なし"
      ),
      "HTTP hangは期限内に診断付きで失敗する"
    );

    console.log("client contract regression check: PASS");
  } finally {
    await server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runClientRegressionCheck();
}
