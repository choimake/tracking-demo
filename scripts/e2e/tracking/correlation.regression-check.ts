import assert from "node:assert/strict";
import http from "node:http";

interface TestHit {
  id: string;
  eventId: string | null;
  type: "event" | "pageview";
  url: string;
  ts: string;
  test: boolean;
  ua: string;
  vid: string;
  sid: string;
  workspaceId: string;
}

const correlationA = "run-a/chromium/0-scenario";
const correlationB = "run-a/firefox/0-scenario";
const correlationOtherScenario = "run-a/chromium/1-other-scenario";
const correlationOtherRun = "run-b/chromium/0-scenario";
const suffixA = ` td-e2e/${correlationA}`;
const suffixB = ` td-e2e/${correlationB}`;
const suffixOtherScenario = ` td-e2e/${correlationOtherScenario}`;
const suffixOtherRun = ` td-e2e/${correlationOtherRun}`;
const hit = (
  id: string,
  ua: string,
  ts: string,
  type: "event" | "pageview" = "event"
): TestHit => ({
  eventId: type === "event" ? "ev_purchase" : null,
  id,
  sid: "s_00000000-0000-0000-0000-000000000000",
  test: false,
  ts,
  type,
  ua,
  url: "/order/complete",
  vid: "v_00000000-0000-0000-0000-000000000000",
  workspaceId: "ws-001",
});

const hits: TestHit[] = [
  hit("seed-past", "seed", "1970-01-01T00:00:00.000Z"),
  hit("other-browser", `Firefox${suffixB}`, "2026-01-01T00:00:00.000Z"),
  hit(
    "other-scenario",
    `Chrome${suffixOtherScenario}`,
    "2026-01-01T00:00:00.000Z"
  ),
  hit("other-run", `Chrome${suffixOtherRun}`, "2026-01-01T00:00:00.000Z"),
  hit("cursor", `Chrome${suffixA}`, "1970-01-01T00:00:00.000Z"),
  hit("prefix-attack", `Chrome${suffixA}/extra`, "2999-01-01T00:00:00.000Z"),
  hit("target-future", `Chrome${suffixA}`, "2999-01-01T00:00:00.000Z"),
  hit(
    "target-pageview",
    `Chrome${suffixA}`,
    "1900-01-01T00:00:00.000Z",
    "pageview"
  ),
];

export async function runCorrelationRegressionCheck(): Promise<void> {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ hits }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { TrackingClient } = await import("./client.js");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const tracking = new TrackingClient(
      correlationA,
      `http://127.0.0.1:${address.port}`
    );

    assert.deepEqual(
      (
        await tracking.getHitsMatching({
          eventId: "ev_purchase",
          type: "event",
        })
      ).map((item) => item.id),
      ["cursor", "target-future"],
      "時刻に依存せず、完全一致する相関 ID の Hit だけを選ぶ"
    );
    assert.deepEqual(
      (
        await tracking.getHitsMatching({
          afterHitId: "cursor",
          eventId: "ev_purchase",
          type: "event",
        })
      ).map((item) => item.id),
      ["target-future"],
      "Hit カーソルより後だけを選ぶ"
    );
    assert.equal(await tracking.getPageviewCountAfter("cursor"), 1);
    assert.equal(await tracking.getEventCount7d("ev_purchase"), 2);
    await assert.rejects(
      tracking.getHitsMatching({ afterHitId: "missing" }),
      // 欠落したHit cursorの診断へマッチする。例: `Hit cursor が観測結果に存在しません: missing`。
      /Hit cursor が観測結果に存在しません/
    );
    console.log("correlation regression check: PASS");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCorrelationRegressionCheck();
}
