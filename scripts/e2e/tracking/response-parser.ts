/** このモジュールは、未知の JSON を検証して E2E 用の応答型へ変換する。 */

export function parseJsonResponse<T>(
  text: string,
  method: string,
  path: string
): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `${method} ${path} のJSONが不正です: expected=valid JSON actual=${JSON.stringify(text.slice(0, 200))}`,
      { cause: error }
    );
  }
}

export interface EventSummary {
  id: string;
  name: string;
  count7d: number;
  enabled: boolean;
}

export interface HitRecord {
  id: string;
  eventId: string | null;
  type: string;
  url: string;
  ts: string;
  test: boolean;
  ua: string;
  vid: string;
  sid: string;
  workspaceId: string;
}

export interface TagCheckResult {
  count: number;
  hits: HitRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actualValue(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function requireStringField(
  value: Record<string, unknown>,
  field: string,
  location: string,
  apiName: string
): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    throw new Error(
      `${apiName}応答が不正です: ${location}.${field}: expected=string actual=${actualValue(fieldValue)}`
    );
  }
  return fieldValue;
}

function parseHitRecord(
  value: unknown,
  index: number,
  apiName: string
): HitRecord {
  const location = `hits[${index}]`;
  if (!isRecord(value)) {
    throw new Error(
      `${apiName}応答が不正です: ${location}: expected=object actual=${actualValue(value)}`
    );
  }
  if (value.eventId !== null && typeof value.eventId !== "string") {
    throw new Error(
      `${apiName}応答が不正です: ${location}.eventId: expected=string|null actual=${actualValue(value.eventId)}`
    );
  }
  if (typeof value.test !== "boolean") {
    throw new Error(
      `${apiName}応答が不正です: ${location}.test: expected=boolean actual=${actualValue(value.test)}`
    );
  }
  return {
    eventId: value.eventId,
    id: requireStringField(value, "id", location, apiName),
    sid: requireStringField(value, "sid", location, apiName),
    test: value.test,
    ts: requireStringField(value, "ts", location, apiName),
    type: requireStringField(value, "type", location, apiName),
    ua: requireStringField(value, "ua", location, apiName),
    url: requireStringField(value, "url", location, apiName),
    vid: requireStringField(value, "vid", location, apiName),
    workspaceId: requireStringField(value, "workspaceId", location, apiName),
  };
}

export function parseObservationHits(value: unknown): HitRecord[] {
  if (!isRecord(value) || !Array.isArray(value.hits)) {
    throw new Error(
      `観測API応答が不正です: hits: expected=array actual=${actualValue(isRecord(value) ? value.hits : value)}`
    );
  }
  return value.hits.map((hit, index) => parseHitRecord(hit, index, "観測API"));
}

function parseEventSummary(
  value: unknown,
  index: number,
  apiName = "管理API"
): EventSummary {
  const location = `events[${index}]`;
  if (!isRecord(value)) {
    throw new Error(
      `${apiName}応答が不正です: ${location}: expected=object actual=${actualValue(value)}`
    );
  }
  if (typeof value.count7d !== "number" || !Number.isFinite(value.count7d)) {
    throw new Error(
      `${apiName}応答が不正です: ${location}.count7d: expected=finite number actual=${actualValue(value.count7d)}`
    );
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error(
      `${apiName}応答が不正です: ${location}.enabled: expected=boolean actual=${actualValue(value.enabled)}`
    );
  }
  return {
    count7d: value.count7d,
    enabled: value.enabled,
    id: requireStringField(value, "id", location, apiName),
    name: requireStringField(value, "name", location, apiName),
  };
}

export function parseEventSummaries(value: unknown): EventSummary[] {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw new Error(
      `管理API応答が不正です: events: expected=array actual=${actualValue(isRecord(value) ? value.events : value)}`
    );
  }
  return value.events.map((event, index) => parseEventSummary(event, index));
}

export function parseTagCheckResult(value: unknown): TagCheckResult {
  if (!isRecord(value)) {
    throw new Error(
      `管理API /api/tag-check応答が不正です: response: expected=object actual=${actualValue(value)}`
    );
  }
  if (
    typeof value.count !== "number" ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0
  ) {
    throw new Error(
      `管理API /api/tag-check応答が不正です: count: expected=non-negative integer actual=${actualValue(value.count)}`
    );
  }
  if (!Array.isArray(value.hits)) {
    throw new Error(
      `管理API /api/tag-check応答が不正です: hits: expected=array actual=${actualValue(value.hits)}`
    );
  }
  return {
    count: value.count,
    hits: value.hits.map((hit, index) =>
      parseHitRecord(hit, index, "管理API /api/tag-check")
    ),
  };
}

export function parseEventMutation(
  value: unknown,
  apiName: string
): EventSummary {
  if (!isRecord(value) || !isRecord(value.event)) {
    throw new Error(
      `${apiName}応答が不正です: event: expected=object actual=${actualValue(isRecord(value) ? value.event : value)}`
    );
  }
  return parseEventSummary(value.event, 0, apiName);
}

export function parseDeleteResult(value: unknown): void {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(
      `管理API DELETE /api/events/:id応答が不正です: ok: expected=true actual=${actualValue(isRecord(value) ? value.ok : value)}`
    );
  }
}
