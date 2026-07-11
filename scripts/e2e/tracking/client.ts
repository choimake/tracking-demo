import { readFile } from "node:fs/promises";

import { TRACKING_ORIGIN, DB_PATH } from "../harness/config.js";

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
  sinceMs?: number;
}

export interface CreateEventInput {
  name: string;
  description: string;
  trigger: string;
  labelIds: string[];
}

/** 計測サーバー(TRACKING_ORIGIN)の管理APIへのアクセスをまとめたクライアント */
export class TrackingClient {
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
    return (
      (await this.getEventSummaries()).find((e) => e.id === eventId)?.count7d ??
      -1
    );
  }

  async getPageviewCountSince(pageviewSinceMs: number): Promise<number> {
    return (
      await this.fetchTracking<{ count: number }>(
        `/api/tag-check?since=${pageviewSinceMs}`
      )
    ).count;
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

  /** sinceMs 以降の pageview ヒット(テスト発火を除く) */
  async getPageviewHitsSince(sinceMs: number): Promise<HitRecord[]> {
    return this.getHitsMatching({ sinceMs, type: "pageview" });
  }

  async getHitsMatching(filter: HitFilter): Promise<HitRecord[]> {
    const nowMs = Date.now();
    return (await this.getAllHits()).filter((h) => {
      if (h.test) {
        return false;
      }
      // seed の未来時刻ヒットが sinceMs フィルタをすり抜けないようにする
      const hitMs = new Date(h.ts).getTime();
      if (hitMs > nowMs + 2000) {
        return false;
      }
      if (filter.eventId !== undefined && h.eventId !== filter.eventId) {
        return false;
      }
      if (filter.type !== undefined && h.type !== filter.type) {
        return false;
      }
      if (filter.sinceMs !== undefined && hitMs < filter.sinceMs) {
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
