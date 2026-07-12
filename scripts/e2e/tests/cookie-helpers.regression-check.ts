import type { Cookie } from "playwright";

import { e2eScenarios } from "../scenarios.js";
import {
  assertCookieExpires,
  assertDemoCookieAttrs,
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

console.log("cookie helpers regression: OK");
