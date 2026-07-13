import assert from "node:assert/strict";

import type { Cookie } from "playwright";

import type { HitRecord } from "../harness/types.js";
import { e2eScenarios } from "../scenarios.js";
import { parseAssertionFailure } from "../tracking/index.js";
import {
  assertCookieExpires,
  assertDemoCookieAttrs,
  expectVisitPageviewExactlyOnce,
} from "./cookie-helpers.js";

const cookieScenarios = e2eScenarios.filter((scenario) =>
  scenario.name.startsWith("Cookie")
);
if (cookieScenarios.length !== 8) {
  throw new Error(`Cookieシナリオ数が不正: ${cookieScenarios.length}`);
}
if (new Set(cookieScenarios.map((scenario) => scenario.name)).size !== 8) {
  throw new Error("Cookieシナリオ名が一意ではない");
}
if (new Set(cookieScenarios.map((scenario) => scenario.run)).size !== 8) {
  throw new Error("Cookieシナリオの実行関数が一意ではない");
}

const base: Cookie = {
  domain: "localhost",
  expires: 1_800,
  httpOnly: false,
  name: "_td_sid",
  path: "/",
  sameSite: "Lax",
  secure: false,
  value: "sid_test",
};

assertDemoCookieAttrs(base, "valid");
assertCookieExpires(base, "valid", 1_800, 0, "chromium");

for (const invalid of [
  { ...base, path: "/other" },
  { ...base, sameSite: "Strict" as const },
  { ...base, secure: true },
  { ...base, httpOnly: true },
]) {
  try {
    assertDemoCookieAttrs(invalid, "invalid");
    throw new Error("不正属性を受理した");
  } catch (error) {
    if (String(error).includes("不正属性を受理した")) throw error;
  }
}

assert.throws(
  () => assertDemoCookieAttrs({ ...base, sameSite: "Strict" }, "_td_sid"),
  (error: unknown) => {
    assert(error instanceof Error);
    const details = parseAssertionFailure(error.message);
    assert.deepEqual(details?.actual, { path: "/", sameSite: "Strict" });
    assert.deepEqual(details?.expected, { path: "/", sameSite: "Lax" });
    assert.equal(details?.context.cookieName, "_td_sid");
    return true;
  },
  "Cookie assertionは共通formatterでactual、expected、contextを構造化する"
);

try {
  assertCookieExpires(
    { ...base, expires: 99_999 },
    "invalid",
    1_800,
    0,
    "chromium"
  );
  throw new Error("不正expiresを受理した");
} catch (error) {
  if (String(error).includes("不正expiresを受理した")) throw error;
}

const pageview = (id: string, vid: string, sid: string): HitRecord => ({
  eventId: null,
  id,
  sid,
  test: false,
  ts: "2026-07-13T00:00:00.000Z",
  type: "pageview",
  ua: "regression-check",
  url: "http://localhost/products",
  vid,
  workspaceId: "ws-001",
});
const expectedVid = "v_00000000-0000-4000-8000-000000000002";
const expectedSid = "s_00000000-0000-4000-8000-000000000002";
const precedingDuplicate = pageview(
  "duplicate",
  "v_00000000-0000-4000-8000-000000000001",
  "s_00000000-0000-4000-8000-000000000001"
);
const correctLastHit = pageview("correct", expectedVid, expectedSid);
const immediateDuplicateReader = {
  getHitsMatching: async () => [precedingDuplicate, correctLastHit],
};
const lastHit = (await immediateDuplicateReader.getHitsMatching()).at(-1);
assert.equal(lastHit?.vid, expectedVid, "最後のHitは正しいvidを持つ");
assert.equal(lastHit?.sid, expectedSid, "最後のHitは正しいsidを持つ");
await assert.rejects(
  expectVisitPageviewExactlyOnce(
    immediateDuplicateReader,
    "cursor",
    "先行する重複pageview",
    { observationMs: 20, pollIntervalMs: 2, timeoutMs: 20 }
  ),
  /got=2 want=1/,
  "最後のHitが正しい場合も先行する重複Hitを検出する"
);

let lateDuplicateReads = 0;
const lateDuplicateReader = {
  getHitsMatching: async () => {
    lateDuplicateReads += 1;
    return lateDuplicateReads === 1
      ? [correctLastHit]
      : [correctLastHit, precedingDuplicate];
  },
};
await assert.rejects(
  expectVisitPageviewExactlyOnce(
    lateDuplicateReader,
    "cursor",
    "遅延する重複pageview",
    { observationMs: 60, pollIntervalMs: 5, timeoutMs: 20 }
  ),
  /got=2 want=1/,
  "settle観測中に届く重複Hitを検出する"
);

console.log("cookie helpers regression: OK");
