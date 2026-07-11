import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ROOT } from "./paths.js";
import type { DbShape, Hit, TrackEvent } from "./types.js";

const DB_FILE = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(ROOT, "data", "db.json");
const DATA_DIR = path.dirname(DB_FILE);

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function seed(): DbShape {
  const now = new Date();
  const iso = now.toISOString();
  const labels = [
    { color: "#e5484d", id: "lb_cv", name: "CV" },
    { color: "#3b82f6", id: "lb_eng", name: "エンゲージメント" },
    { color: "#8b8d98", id: "lb_trial", name: "検討中" },
  ];
  const ev = (
    id: string,
    name: string,
    description: string,
    trigger: string,
    enabled: boolean,
    labelIds: string[]
  ): TrackEvent => ({
    createdAt: iso,
    description,
    enabled,
    id,
    labelIds,
    name,
    trigger,
    updatedAt: iso,
    workspaceId: "ws-001",
  });
  const events: TrackEvent[] = [
    ev(
      "ev_purchase",
      "購入完了",
      "注文完了ページへの到達を計測",
      "url:/order/complete",
      true,
      ["lb_cv"]
    ),
    ev(
      "ev_cart",
      "カート追加",
      "「カートに入れる」ボタンのクリックを計測",
      "click:.add-to-cart",
      true,
      ["lb_eng"]
    ),
    ev(
      "ev_scroll50",
      "スクロール50%",
      "ページの縦50%地点への到達を計測",
      "scroll:50",
      true,
      ["lb_eng"]
    ),
    ev(
      "ev_read60",
      "熟読ユーザー",
      "ページ読み込み後60秒以上の滞在を計測",
      "time_on_page:60",
      false,
      ["lb_eng"]
    ),
    ev(
      "ev_exit",
      "離脱インテント",
      "カーソルがビューポート外(上方向)へ出た瞬間を計測",
      "exit_intent",
      false,
      ["lb_trial"]
    ),
    ev(
      "ev_contact",
      "資料請求完了",
      "資料請求フォームの完了ページ到達を計測",
      "url:/contact/complete",
      false,
      ["lb_cv"]
    ),
  ];
  // 直近7日間のダミー計測実績(有効イベントのみ)
  const hits: Hit[] = [];
  const perDay: Record<string, number[]> = {
    ev_cart: [12, 9, 15, 11, 18, 14, 10],
    ev_purchase: [3, 5, 2, 6, 4, 7, 5],
    ev_scroll50: [40, 35, 52, 47, 44, 58, 41],
  };
  for (const [eventId, counts] of Object.entries(perDay)) {
    counts.forEach((count, daysAgo) => {
      for (let i = 0; i < count; i++) {
        // 集計はローカル暦日単位なので、意図した日の内側に収まる時刻で生成する
        const ts = new Date(now);
        ts.setDate(ts.getDate() - daysAgo);
        ts.setHours(
          1 + Math.floor(Math.random() * 20),
          Math.floor(Math.random() * 60),
          0,
          0
        );
        hits.push({
          eventId,
          id: newId("hit"),
          sid: "",
          test: false,
          ts: ts.toISOString(),
          type: "event",
          ua: "seed",
          url: "http://localhost:3200/",
          vid: "",
          workspaceId: "ws-001",
        });
      }
    });
  }
  return {
    events,
    hits,
    labels,
    workspace: { id: "ws-001", name: "デモサイト計測", createdAt: iso },
  };
}

// 要素レベルの欠損をデフォルト値で補完する。
// 手編集や旧形式の db.json(例: labelIds のないイベント)で管理 API が 500 にならないように
function repair(data: DbShape): DbShape {
  for (const e of data.events) {
    if (!Array.isArray(e.labelIds)) {
      e.labelIds = [];
    }
    e.labelIds = e.labelIds.filter((id) => typeof id === "string");
    if (typeof e.name !== "string") {
      e.name = "(名称未設定)";
    }
    if (typeof e.description !== "string") {
      e.description = "";
    }
    if (typeof e.trigger !== "string") {
      e.trigger = "";
    }
    if (typeof e.enabled !== "boolean") {
      e.enabled = false;
    }
  }
  for (const l of data.labels) {
    if (typeof l.name !== "string") {
      l.name = "(名称未設定)";
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(l.color))) {
      l.color = "#8b8d98";
    }
  }
  for (const h of data.hits) {
    if (typeof h.test !== "boolean") {
      h.test = false;
    }
    if (typeof h.ua !== "string") {
      h.ua = "";
    }
    if (typeof h.vid !== "string") {
      h.vid = "";
    }
    if (typeof h.sid !== "string") {
      h.sid = "";
    }
  }
  return data;
}

function load(): DbShape {
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(DB_FILE, "utf8")
      ) as Partial<DbShape>;
      if (
        parsed.workspace &&
        Array.isArray(parsed.events) &&
        Array.isArray(parsed.labels) &&
        Array.isArray(parsed.hits)
      ) {
        return repair(parsed as DbShape);
      }
      throw new Error("db.json の形式が不正");
    } catch {
      const bak = `${DB_FILE}.bak`;
      fs.renameSync(DB_FILE, bak);
      console.warn(
        `db.json が破損していたため ${path.basename(bak)} に退避して再シードします`
      );
    }
  }
  const data = seed();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  return data;
}

export const db: DbShape = load();

// tmp に書いてから rename するアトミック保存(書き込み中のクラッシュで破損させない)
function writeDb(): void {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

let saveTimer: NodeJS.Timeout | null = null;
const SAVE_DEBOUNCE_MS = Number(process.env.DB_SAVE_DEBOUNCE_MS ?? 100);
export function save(): void {
  if (saveTimer) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeDb();
    } catch (error) {
      // Express のリクエストハンドラ外(タイマーのコールバック)で例外を投げると
      // uncaught exception としてプロセス全体(計測サーバー+デモサイト)が落ちるため、
      // ここで握りつぶしてログだけ残す(ディスクフル・権限喪失等でもプロセスは生存させる)
      console.error("db.json の書き込みに失敗しました", error);
    }
  }, SAVE_DEBOUNCE_MS);
}

// プロセス終了時にデバウンス中の保存を取りこぼさない
function flush(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      writeDb();
    } catch (error) {
      // ここで例外を投げると SIGINT/SIGTERM ハンドラの process.exit() に到達できず
      // プロセスがハング/uncaught で落ちるため、save() 同様に握りつぶしてログだけ残す
      console.error("db.json の書き込みに失敗しました(終了時)", error);
    }
  }
}
process.on("exit", flush);
process.on("SIGINT", () => {
  flush();
  process.exit(130);
});
process.on("SIGTERM", () => {
  flush();
  process.exit(143);
});
