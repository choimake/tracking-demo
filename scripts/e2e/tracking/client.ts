import { readFile } from "node:fs/promises";

import {
  DB_PATH,
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

/** 計測サーバー(TRACKING_ORIGIN)の管理APIへのアクセスをまとめたクライアント */
export class TrackingClient {
  constructor(private readonly correlationId?: string) {}

  async fetchTracking<T = unknown>(
    path: string,
    opts: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(TRACKING_ORIGIN + path, {
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

  async getEventCount7d(eventId: string): Promise<number> {
    if (this.correlationId) {
      return (await this.getHitsMatching({ eventId, type: "event" })).length;
    }
    return (
      (await this.getEventSummaries()).find((e) => e.id === eventId)?.count7d ??
      -1
    );
  }

  /** 管理 API が表示する直近7日間のイベント件数 */
  async getEventCount7dFromApi(eventId: string): Promise<number> {
    return (
      (await this.getEventSummaries()).find((e) => e.id === eventId)?.count7d ??
      -1
    );
  }

  /** cursor より後の相関済み pageview 件数 */
  async getPageviewCountAfter(afterHitId?: string): Promise<number> {
    return (await this.getHitsMatching({ afterHitId, type: "pageview" }))
      .length;
  }

  // 疑似DBファイルを直接読む(受信経路を通らず記録内容そのものを確認するため)
  async getAllHits(): Promise<HitRecord[]> {
    const raw = JSON.parse(await readFile(DB_PATH, "utf8")) as {
      hits: HitRecord[];
    };
    return raw.hits;
  }

  async getHitsForEvent(eventId: string): Promise<HitRecord[]> {
    return (await this.getAllHits()).filter((h) => h.eventId === eventId);
  }

  /** cursor より後の pageview ヒット(テスト発火を除く) */
  async getPageviewHitsAfter(afterHitId?: string): Promise<HitRecord[]> {
    return this.getHitsMatching({ afterHitId, type: "pageview" });
  }

  /** Act 前の DB 末尾を取得する。Hit がない場合は undefined を返す */
  async captureHitCursor(): Promise<string | undefined> {
    return (await this.getAllHits()).at(-1)?.id;
  }

  async getHitsMatching(filter: HitFilter): Promise<HitRecord[]> {
    const allHits = await this.getAllHits();
    const cursorIndex = filter.afterHitId
      ? allHits.findIndex((hit) => hit.id === filter.afterHitId)
      : -1;
    if (filter.afterHitId && cursorIndex < 0) {
      throw new Error(`Hit cursor が DB に存在しません: ${filter.afterHitId}`);
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
