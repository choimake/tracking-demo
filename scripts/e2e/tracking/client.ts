import {
  DEFAULT_WAIT_TIMEOUT_MS,
  E2E_CORRELATION_UA_PREFIX,
  getTrackingOrigin,
  registeredAbortSignal,
} from "../harness/config.js";
import { recordAssertionHitCursor } from "./assertion-formatter.js";

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
  /** 匿名再訪識別子(client_id 相当)。欠落時は空文字 */
  vid: string;
  /** セッション識別子(session_id 相当)。欠落時は空文字 */
  sid: string;
  workspaceId: string;
}

export interface HitFilter {
  eventId?: string | null;
  type?: string;
  /** この Hit より後に追記された Hit だけを選ぶ。undefined は DB 先頭から選ぶ */
  afterHitId?: string;
}

export interface CreateEventInput {
  name: string;
  description: string;
  trigger: string;
  labelIds: string[];
}

export interface TagCheckResult {
  count: number;
  hits: HitRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actualValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
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

function parseObservationHits(value: unknown): HitRecord[] {
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

function parseEventSummaries(value: unknown): EventSummary[] {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw new Error(
      `管理API応答が不正です: events: expected=array actual=${actualValue(isRecord(value) ? value.events : value)}`
    );
  }
  return value.events.map((event, index) => parseEventSummary(event, index));
}

function parseTagCheckResult(value: unknown): TagCheckResult {
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

function parseEventMutation(value: unknown, apiName: string): EventSummary {
  if (!isRecord(value) || !isRecord(value.event)) {
    throw new Error(
      `${apiName}応答が不正です: event: expected=object actual=${actualValue(isRecord(value) ? value.event : value)}`
    );
  }
  return parseEventSummary(value.event, 0, apiName);
}

function parseDeleteResult(value: unknown): void {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(
      `管理API DELETE /api/events/:id応答が不正です: ok: expected=true actual=${actualValue(isRecord(value) ? value.ok : value)}`
    );
  }
}

/** 計測サーバーの管理APIへのアクセスをまとめたクライアント */
export class TrackingClient {
  private diagnosticHitCursorCaptured = false;
  private diagnosticHitCursorValue: string | undefined;

  constructor(
    private readonly correlationId?: string,
    private readonly trackingOrigin = getTrackingOrigin(),
    private readonly requestTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS
  ) {}

  async fetchTracking<T = unknown>(
    path: string,
    opts: RequestInit = {}
  ): Promise<T> {
    const method = opts.method ?? "GET";
    const timeoutSignal = registeredAbortSignal(
      "tracking-fetch-deadline",
      this.requestTimeoutMs
    );
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal;
    let res: Response;
    let text: string;
    try {
      res = await fetch(this.trackingOrigin + path, {
        headers: { "Content-Type": "application/json" },
        ...opts,
        signal,
      });
      if (!res.ok) {
        throw new Error(`${method} ${path} -> HTTP ${res.status}`);
      }
      text = await res.text();
    } catch (error) {
      if (timeoutSignal.aborted) {
        throw new Error(
          `${method} ${path} が timeout: expected=${this.requestTimeoutMs}ms以内のHTTP応答 actual=応答なし`,
          { cause: error }
        );
      }
      throw error;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(
        `${method} ${path} のJSONが不正です: expected=valid JSON actual=${JSON.stringify(text.slice(0, 200))}`,
        { cause: error }
      );
    }
  }

  async getEventSummaries(): Promise<EventSummary[]> {
    return parseEventSummaries(
      await this.fetchTracking<unknown>("/api/events")
    );
  }

  /**
   * 相関 ID がある場合は期間を限定せず、相関する全 Hit を数える。
   * 相関 ID がない場合は管理 API が返す直近7日間の件数を返す。
   */
  async getEventCount7d(eventId: string): Promise<number> {
    if (this.correlationId) {
      return (await this.getHitsMatching({ eventId, type: "event" })).length;
    }
    return this.requireEventSummary(eventId, await this.getEventSummaries())
      .count7d;
  }

  /** 管理 API が表示する直近7日間のイベント件数 */
  async getEventCount7dFromApi(eventId: string): Promise<number> {
    return this.requireEventSummary(eventId, await this.getEventSummaries())
      .count7d;
  }

  /** 管理画面のタグ動作確認 API が返す pageview を取得する */
  async getTagCheck(sinceMs: number): Promise<TagCheckResult> {
    return parseTagCheckResult(
      await this.fetchTracking<unknown>(`/api/tag-check?since=${sinceMs}`)
    );
  }

  /** cursor より後の相関済み pageview 件数 */
  async getPageviewCountAfter(afterHitId?: string): Promise<number> {
    return (await this.getHitsMatching({ afterHitId, type: "pageview" }))
      .length;
  }

  private requireEventSummary(
    eventId: string,
    events: EventSummary[]
  ): EventSummary {
    const event = events.find((item) => item.id === eventId);
    if (!event) {
      throw new Error(
        `イベントが管理API応答に存在しません: eventId=${eventId}`
      );
    }
    return event;
  }

  /** E2E専用の観測APIから、collect済みのHitを取得する。 */
  async getAllHits(): Promise<HitRecord[]> {
    return parseObservationHits(
      await this.fetchTracking<unknown>("/api/e2e/observations/hits")
    );
  }

  async getHitsForEvent(eventId: string): Promise<HitRecord[]> {
    return (await this.getAllHits()).filter((h) => h.eventId === eventId);
  }

  /** cursor より後の pageview ヒット(テスト発火を除く) */
  async getPageviewHitsAfter(afterHitId?: string): Promise<HitRecord[]> {
    return this.getHitsMatching({ afterHitId, type: "pageview" });
  }

  /** Act 前の観測末尾を取得する。Hit がない場合はundefinedを返す。 */
  async captureHitCursor(): Promise<string | undefined> {
    const cursor = (await this.getAllHits()).at(-1)?.id;
    this.diagnosticHitCursorCaptured = true;
    this.diagnosticHitCursorValue = cursor;
    recordAssertionHitCursor(cursor);
    return cursor;
  }

  /** 診断manifest用に最後のHit cursor取得結果を返す。 */
  getDiagnosticHitCursor(): { captured: boolean; value: string | null } {
    return {
      captured: this.diagnosticHitCursorCaptured,
      value: this.diagnosticHitCursorValue ?? null,
    };
  }

  async getHitsMatching(filter: HitFilter): Promise<HitRecord[]> {
    const allHits = await this.getAllHits();
    const cursorIndex = filter.afterHitId
      ? allHits.findIndex((hit) => hit.id === filter.afterHitId)
      : -1;
    if (filter.afterHitId && cursorIndex < 0) {
      throw new Error(
        `Hit cursor が観測結果に存在しません: ${filter.afterHitId}`
      );
    }
    const expectedUaSuffix = this.correlationId
      ? ` ${E2E_CORRELATION_UA_PREFIX}${this.correlationId}`
      : undefined;
    return allHits.slice(cursorIndex + 1).filter((h) => {
      if (h.test) {
        return false;
      }
      if (expectedUaSuffix && !h.ua.endsWith(expectedUaSuffix)) {
        return false;
      }
      if (filter.eventId !== undefined && h.eventId !== filter.eventId) {
        return false;
      }
      if (filter.type !== undefined && h.type !== filter.type) {
        return false;
      }
      return true;
    });
  }

  async toggleEvent(eventId: string, enabled: boolean): Promise<void> {
    parseEventMutation(
      await this.fetchTracking(`/api/events/${eventId}/toggle`, {
        body: JSON.stringify({ enabled }),
        method: "POST",
      }),
      "管理API POST /api/events/:id/toggle"
    );
  }

  async createEvent(input: CreateEventInput): Promise<string> {
    const created = parseEventMutation(
      await this.fetchTracking<unknown>("/api/events", {
        body: JSON.stringify(input),
        method: "POST",
      }),
      "管理API POST /api/events"
    );
    return created.id;
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      parseDeleteResult(
        await this.fetchTracking(`/api/events/${eventId}`, {
          method: "DELETE",
        })
      );
    } catch (error) {
      // teardown再試行時に、前回削除済みのfixtureは回収済みとして扱う。
      if (error instanceof Error && error.message.endsWith("-> HTTP 404")) {
        return;
      }
      throw error;
    }
  }
}
