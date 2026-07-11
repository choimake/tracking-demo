// トリガー種別の定義は shared/trigger.ts が唯一のソース
export type { TriggerType } from "./shared/trigger.js";

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export interface TrackEvent {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  /** 例: "url:/order/complete", "click:.add-to-cart", "time_on_page:60", "scroll:50", "exit_intent" */
  trigger: string;
  enabled: boolean;
  labelIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Hit {
  id: string;
  workspaceId: string;
  /** pageview の場合は null */
  eventId: string | null;
  type: "event" | "pageview";
  url: string;
  ts: string;
  /** ブラウザの User-Agent 文字列(欠落時は空文字) */
  ua: string;
  /**
   * 匿名の再訪識別子(GA4 client_id 相当)。Cookie `_td_vid`。
   * user_id ではない。管理画面テスト発火などブラウザ外は空文字
   */
  vid: string;
  /**
   * セッション識別子(GA4 session_id 相当)。Cookie `_td_sid`。
   * 30分無操作で切れる。管理画面テスト発火などブラウザ外は空文字
   */
  sid: string;
  /** テスト発火によるヒット。計測件数には含めない */
  test: boolean;
}

export interface DbShape {
  workspace: Workspace;
  events: TrackEvent[];
  labels: Label[];
  hits: Hit[];
}
