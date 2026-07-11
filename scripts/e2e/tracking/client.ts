import {
  E2E_CORRELATION_UA_PREFIX,
  TRACKING_ORIGIN,
} from "../harness/config.js";

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

function requireStringField(
  value: Record<string, unknown>,
  field: string,
  index: number
): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    throw new Error(
      `観測API応答が不正です: hits[${index}].${field} がstringではありません`
    );
  }
  return fieldValue;
}

function parseHitRecord(value: unknown, index: number): HitRecord {
  if (!isRecord(value)) {
    throw new Error(
      `観測API応答が不正です: hits[${index}] がobjectではありません`
    );
  }
  if (value.eventId !== null && typeof value.eventId !== "string") {
    throw new Error(
      `観測API応答が不正です: hits[${index}].eventId がstring|nullではありません`
    );
  }
  if (typeof value.test !== "boolean") {
    throw new Error(
      `観測API応答が不正です: hits[${index}].test がbooleanではありません`
    );
  }
  return {
    eventId: value.eventId,
    id: requireStringField(value, "id", index),
    sid: requireStringField(value, "sid", index),
    test: value.test,
    ts: requireStringField(value, "ts", index),
    type: requireStringField(value, "type", index),
    ua: requireStringField(value, "ua", index),
    url: requireStringField(value, "url", index),
    vid: requireStringField(value, "vid", index),
    workspaceId: requireStringField(value, "workspaceId", index),
  };
}

function parseObservationHits(value: unknown): HitRecord[] {
  if (!isRecord(value) || !Array.isArray(value.hits)) {
    throw new Error("観測API応答が不正です: hits配列がありません");
  }
  return value.hits.map(parseHitRecord);
}

/** 計測サーバー(TRACKING_ORIGIN)の管理APIへのアクセスをまとめたクライアント */
export class TrackingClient {
  constructor(
    private readonly correlationId?: string,
    private readonly trackingOrigin = TRACKING_ORIGIN
  ) {}

  async fetchTracking<T = unknown>(
    path: string,
    opts: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(this.trackingOrigin + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      throw new Error(`${opts.method ?? "GET"} ${path} -> HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async getEventSummaries(): Promise<EventSummary[]> {
    return (await this.fetchTracking<{ events: EventSummary[] }>("/api/events"))
      .events;
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
    return this.fetchTracking<TagCheckResult>(
      `/api/tag-check?since=${sinceMs}`
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
    return (await this.getAllHits()).at(-1)?.id;
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
    await this.fetchTracking(`/api/events/${eventId}/toggle`, {
      body: JSON.stringify({ enabled }),
      method: "POST",
    });
  }

  async createEvent(input: CreateEventInput): Promise<string> {
    const created = await this.fetchTracking<{ event: { id: string } }>(
      "/api/events",
      {
        body: JSON.stringify(input),
        method: "POST",
      }
    );
    return created.event.id;
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.fetchTracking(`/api/events/${eventId}`, { method: "DELETE" });
  }
}
