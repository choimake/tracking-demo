import { DEFAULT_WAIT_TIMEOUT_MS } from "../harness/config.js";
import { assertionError } from "./assertion-formatter.js";
import type { HitFilter, HitRecord, TrackingClient } from "./client.js";
import { expectHitCountAtLeast } from "./count-assertions.js";

/** このモジュールは、Hit 1件の取得、識別子、payload、時刻を検証する。 */

const E2E_ASSERTIONS_STARTED_AT_MS = Date.now();
type TagCheckReader = Pick<TrackingClient, "getTagCheck">;
type NewHitReader = Pick<TrackingClient, "getHitsMatching">;

/** `/api/tag-check` が指定した Hit を返すことを検証する。 */
export async function expectTagCheckContainsHit(
  tracking: TagCheckReader,
  hit: HitRecord
): Promise<void> {
  const tagCheck = await tracking.getTagCheck(Date.parse(hit.ts));
  if (!tagCheck.hits.some((tagCheckHit) => tagCheckHit.id === hit.id)) {
    const actualHitIds = tagCheck.hits.map((item) => item.id);
    throw assertionError({
      actual: { hitIds: actualHitIds },
      expected: { hitId: hit.id },
      name: "tag-check-contains-hit",
      summary: `/api/tag-check の応答に受信済み pageview が含まれない: actualHitIds=${JSON.stringify(actualHitIds)} expectedHitId=${hit.id}`,
    });
  }
  console.log("  ✓ /api/tag-check が受信済み pageview を返す");
}

export async function waitForNewHit(
  tracking: NewHitReader,
  filter: HitFilter,
  label: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<HitRecord> {
  await expectHitCountAtLeast(tracking, filter, 1, label, timeoutMs);
  const found = (await tracking.getHitsMatching(filter)).at(-1);
  if (!found) {
    throw assertionError({
      actual: { count: 0 },
      context: { filter, label },
      expected: { minimumCount: 1 },
      name: "new-hit-exists",
      summary: `Hit 取得結果が不一致: actual=0件 expected=1件以上; label=${label}`,
    });
  }
  return found;
}

export interface ExpectedHitPayload {
  eventId?: string | null;
  type?: "event" | "pageview";
  urlIncludes?: string;
  workspaceId?: string;
  uaIncludes?: string;
  vid?: string;
  sid?: string;
}

/** 匿名vid（`v_` + UUID）にマッチする。例: `v_123e4567-e89b-12d3-a456-426614174000` */
export const ANON_VID_RE = /^v_[0-9a-f-]{36}$/;
/** 匿名sid（`s_` + UUID）にマッチする。例: `s_123e4567-e89b-12d3-a456-426614174000` */
export const ANON_SID_RE = /^s_[0-9a-f-]{36}$/;

/** vid/sidが匿名ID形式に一致することを検証する。 */
export function expectAnonIdentityValues(vid: string, sid: string): void {
  if (!ANON_VID_RE.test(vid)) {
    throw assertionError({
      actual: { vid },
      expected: { vid: "v_<UUID>" },
      name: "anonymous-vid-format",
      summary: `hit.vid の形式が不正または空: actual=${JSON.stringify(vid)} expected=v_<UUID>（例: v_123e4567-e89b-12d3-a456-426614174000）`,
    });
  }
  if (!ANON_SID_RE.test(sid)) {
    throw assertionError({
      actual: { sid },
      expected: { sid: "s_<UUID>" },
      name: "anonymous-sid-format",
      summary: `hit.sid の形式が不正または空: actual=${JSON.stringify(sid)} expected=s_<UUID>（例: s_123e4567-e89b-12d3-a456-426614174000）`,
    });
  }
}

/** ヒットに形式付きの非空 vid/sid が付いていることを検証する。 */
export function expectAnonIdsPresent(hit: HitRecord): void {
  expectAnonIdentityValues(hit.vid, hit.sid);
  console.log("  ✓ hit.vid / hit.sid 形式OK");
}

/** ヒット1件の payload / ts / ua トークンを検証する。 */
export function expectHitPayload(
  hit: HitRecord,
  expected: ExpectedHitPayload
): void {
  if (expected.eventId !== undefined && hit.eventId !== expected.eventId) {
    throw assertionError({
      actual: { eventId: hit.eventId },
      expected: { eventId: expected.eventId },
      name: "hit-payload-event-id",
      summary: `hit.eventId が不一致: got=${hit.eventId} want=${expected.eventId}`,
    });
  }
  if (expected.type !== undefined && hit.type !== expected.type) {
    throw assertionError({
      actual: { type: hit.type },
      expected: { type: expected.type },
      name: "hit-payload-type",
      summary: `hit.type が不一致: got=${hit.type} want=${expected.type}`,
    });
  }
  if (
    expected.urlIncludes !== undefined &&
    !hit.url.includes(expected.urlIncludes)
  ) {
    throw assertionError({
      actual: { url: hit.url },
      expected: { urlIncludes: expected.urlIncludes },
      name: "hit-payload-url",
      summary: `hit.url が期待文字列を含まない: actual=${JSON.stringify(hit.url)} expectedSubstring=${JSON.stringify(expected.urlIncludes)}`,
    });
  }
  if (
    expected.workspaceId !== undefined &&
    hit.workspaceId !== expected.workspaceId
  ) {
    throw assertionError({
      actual: { workspaceId: hit.workspaceId },
      expected: { workspaceId: expected.workspaceId },
      name: "hit-payload-workspace-id",
      summary: `hit.workspaceId が不一致: got=${hit.workspaceId} want=${expected.workspaceId}`,
    });
  }
  if (
    expected.uaIncludes !== undefined &&
    !hit.ua.includes(expected.uaIncludes)
  ) {
    throw assertionError({
      actual: { ua: hit.ua },
      expected: { uaIncludes: expected.uaIncludes },
      name: "hit-payload-user-agent",
      summary: `hit.ua が期待文字列を含まない: actual=${JSON.stringify(hit.ua)} expectedSubstring=${JSON.stringify(expected.uaIncludes)}`,
    });
  }
  if (expected.vid !== undefined && hit.vid !== expected.vid) {
    throw assertionError({
      actual: { vid: hit.vid },
      expected: { vid: expected.vid },
      name: "hit-payload-vid",
      summary: `hit.vid が不一致: got=${hit.vid} want=${expected.vid}`,
    });
  }
  if (expected.sid !== undefined && hit.sid !== expected.sid) {
    throw assertionError({
      actual: { sid: hit.sid },
      expected: { sid: expected.sid },
      name: "hit-payload-sid",
      summary: `hit.sid が不一致: got=${hit.sid} want=${expected.sid}`,
    });
  }
  const hitTimestampMs = Date.parse(hit.ts);
  if (
    !Number.isFinite(hitTimestampMs) ||
    new Date(hitTimestampMs).toISOString() !== hit.ts
  ) {
    throw assertionError({
      actual: { timestamp: hit.ts },
      expected: { format: "UTC ISO 8601" },
      name: "hit-payload-timestamp-format",
      summary: `hit.ts が ISO 形式ではない: actual=${JSON.stringify(hit.ts)} expected=UTC ISO 8601（例: 2026-01-01T00:00:00.000Z）`,
    });
  }
  const checkedAtMs = Date.now();
  if (
    hitTimestampMs < E2E_ASSERTIONS_STARTED_AT_MS ||
    hitTimestampMs > checkedAtMs
  ) {
    const timestampRange = {
      from: new Date(E2E_ASSERTIONS_STARTED_AT_MS).toISOString(),
      to: new Date(checkedAtMs).toISOString(),
    };
    throw assertionError({
      actual: { timestamp: hit.ts },
      expected: { range: timestampRange },
      name: "hit-payload-timestamp-range",
      summary: `hit.ts が E2E 実行範囲外: got=${hit.ts} range=${timestampRange.from}..${timestampRange.to}`,
    });
  }
  expectAnonIdsPresent(hit);
  console.log("  ✓ hit payload 検証OK");
}
