import assert from "node:assert/strict";

const FIRST_TRACKING_PORT = "43101";
const FIRST_SITE_PORT = "43102";
const SECOND_TRACKING_PORT = "43103";
const SECOND_SITE_PORT = "43104";

function restoreEnvironment(
  name: "PORT" | "SITE_PORT",
  original: string | undefined
): void {
  if (original === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = original;
}

async function main(): Promise<void> {
  const originalPort = process.env.PORT;
  const originalSitePort = process.env.SITE_PORT;
  try {
    delete process.env.PORT;
    delete process.env.SITE_PORT;
    const { getDemoSiteOrigin, getTrackingOrigin } =
      await import("./config.js");
    assert.equal(getTrackingOrigin(), "http://localhost:3100");
    assert.equal(getDemoSiteOrigin(), "http://localhost:3200");

    // configの評価後にrun専用ポートを設定するglobal setupの順序を再現する。
    process.env.PORT = FIRST_TRACKING_PORT;
    process.env.SITE_PORT = FIRST_SITE_PORT;
    assert.equal(
      getTrackingOrigin(),
      `http://localhost:${FIRST_TRACKING_PORT}`
    );
    assert.equal(getDemoSiteOrigin(), `http://localhost:${FIRST_SITE_PORT}`);

    // 初回参照時にも値をキャッシュしないことを確認する。
    process.env.PORT = SECOND_TRACKING_PORT;
    process.env.SITE_PORT = SECOND_SITE_PORT;
    assert.equal(
      getTrackingOrigin(),
      `http://localhost:${SECOND_TRACKING_PORT}`
    );
    assert.equal(getDemoSiteOrigin(), `http://localhost:${SECOND_SITE_PORT}`);
  } finally {
    restoreEnvironment("PORT", originalPort);
    restoreEnvironment("SITE_PORT", originalSitePort);
  }
  console.log("config遅延origin回帰チェック: OK");
}

await main();
