// サーバー(バリデーション)と計測スクリプト tracker.ts の両方から使う。
// DOM 依存を入れないこと。

export type TriggerType =
  | "url"
  | "click"
  | "time_on_page"
  | "scroll"
  | "exit_intent";

export interface ParsedTrigger {
  type: TriggerType;
  value: string;
}

export function parseTrigger(trigger: string): ParsedTrigger | null {
  if (trigger === "exit_intent") {
    return { type: "exit_intent", value: "" };
  }
  const i = trigger.indexOf(":");
  if (i <= 0) {
    return null;
  }
  const type = trigger.slice(0, i);
  const value = trigger.slice(i + 1).trim();
  switch (type) {
    case "url": {
      // 照合対象は pathname のみなので、?・# を含む値は保存させない(永遠に発火しない設定を防ぐ)
      return value.startsWith("/") &&
        !value.includes("?") &&
        !value.includes("#")
        ? { type, value }
        : null;
    }
    case "click": {
      return value ? { type, value } : null;
    }
    case "time_on_page": {
      // 上限は 86400 秒(1日)。setTimeout の int32 上限を超える値が
      // 即時発火に化けるのを防ぎ、エラーメッセージの案内とも一致させる
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 86_400
        ? { type, value }
        : null;
    }
    case "scroll": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 100 ? { type, value } : null;
    }
    default: {
      return null;
    }
  }
}

// location.pathname はパーセントエンコード済みのため、日本語等を含む設定値と
// 突き合わせられるよう両辺をデコードして比較する。大文字小文字も同一視する
export function normalizePath(path: string): string {
  let p = path.replace(/\/+$/, "");
  if (p === "") {
    return "/";
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    // 不正なパーセントエンコードはそのまま比較する
  }
  return p.toLowerCase();
}
