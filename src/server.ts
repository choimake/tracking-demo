import path from "node:path";

import { buildSync } from "esbuild";
import express from "express";

import {
  applicationError,
  classifyBoundaryError,
  isBoundaryError,
  loadTrackingServerEnvironment,
  transportError,
  validateCollectInput,
  validateEventInput,
  validateLabelInput,
  validateRequestOrigin,
  validateResourceId,
  validateTagCheckQuery,
  validateToggleInput,
  validateWorkspaceInput,
  validateWorkspaceQuery,
} from "./boundary/index.js";
import type { ApplicationError } from "./boundary/index.js";
import { db, save, newId } from "./db.js";
import { ROOT } from "./paths.js";
import { recommend } from "./recommend.js";
import type { Hit, TrackEvent } from "./types.js";

const environment = loadTrackingServerEnvironment();

export interface CreateTrackingAppOptions {
  collectFetch?: typeof fetch;
}

function allowCors(res: express.Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendApplicationError(
  res: express.Response,
  error: ApplicationError
): void {
  res.status(error.status).json({ code: error.code, error: error.message });
}

export function boundaryErrorMiddleware(
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
): void {
  const boundaryError = classifyBoundaryError(error);
  if (boundaryError.kind !== "application") {
    console.error(
      `HTTP ${boundaryError.kind} error: ${boundaryError.code}`,
      boundaryError.cause
    );
  }
  res.status(boundaryError.status).json({
    code: boundaryError.code,
    error: boundaryError.message,
  });
}

function buildSnippet(base: string, wsId: string): string {
  const trackerUrlPrefix = JSON.stringify(`${base}/tracker.js?id=`);
  const serializedWorkspaceId = JSON.stringify(wsId);
  return `<!-- 計測タグ -->
<script>
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'tracker.start':new Date().getTime(),event:'tracker.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;
j.src=${trackerUrlPrefix}+i;f.parentNode.insertBefore(j,f);
})(window,document,'script','tdDataLayer',${serializedWorkspaceId});
</script>
<!-- End 計測タグ -->`;
}

// 集計はすべて「直近7日間」(サーバーのローカル日付で数えた7暦日)に統一する。
// イベント一覧の件数とレポートの日別合計が同じ窓を見るようにするため
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function last7LocalDays(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(localDateKey(d));
  }
  return days;
}

function dailyCounts(days: string[], match: (h: Hit) => boolean): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const counts = days.map(() => 0);
  for (const h of db.hits) {
    if (!match(h)) continue;
    const i = index.get(localDateKey(new Date(h.ts)));
    if (i !== undefined) counts[i]++;
  }
  return counts;
}

function count7d(eventId: string): number {
  return dailyCounts(
    last7LocalDays(),
    (h) => h.eventId === eventId && !h.test
  ).reduce((a, b) => a + b, 0);
}

function eventView(e: TrackEvent) {
  return {
    ...e,
    count7d: e.enabled ? count7d(e.id) : 0, // 無効時は0件表示(spec)
    recommendation: recommend(e, db.hits),
  };
}

export function createTrackingApp(
  options: CreateTrackingAppOptions = {}
): express.Express {
  const app = express();
  const collectFetch = options.collectFetch ?? fetch;
  // text/plain の JSON パースは sendBeacon を受ける /api/collect に限定する。
  // 全ルートに許可すると、プリフライトなしの単純リクエストで管理APIへ書き込めてしまう(CSRF)
  app.use(
    "/api/collect",
    express.json({ type: ["application/json", "text/plain"] })
  );
  app.use(express.json());

  // ---- 計測スクリプト: TS を起動時にバンドルして配信(CDN 配信の代替) ----
  const trackerJs = buildSync({
    bundle: true,
    entryPoints: [path.join(ROOT, "src/tracker/tracker.ts")],
    format: "iife",
    target: "es2018",
    write: false,
  }).outputFiles[0].text;

  app.get("/tracker.js", (_req, res) => {
    res.type("application/javascript").send(trackerJs);
  });

  // ---- 計測系 API(サイト側から叩かれるため CORS 許可) ----
  app.get("/api/config", (req, res) => {
    allowCors(res);
    const input = validateWorkspaceQuery(req.query, db.workspace.id);
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    res.json({
      events: db.events
        .filter((e) => e.enabled)
        .map((e) => ({ id: e.id, name: e.name, trigger: e.trigger })),
    });
  });

  app.options("/api/collect", (_req, res) => {
    allowCors(res);
    res.sendStatus(204);
  });

  app.post("/api/collect", (req, res) => {
    allowCors(res);
    const input = validateCollectInput(req.body, db.workspace.id);
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    const { eventId, isTest, sid, type, ua, url, vid } = input.value;
    if (type === "event") {
      const event = db.events.find((e) => e.id === eventId);
      if (!event) {
        res.status(202).json({ ok: false, reason: "unknown event" });
        return;
      }
      // 無効イベントは計測停止(受信しても記録しない)。テスト発火のみ動作確認のため通す
      if (!event.enabled && !isTest) {
        res.status(202).json({ ok: false, reason: "event disabled" });
        return;
      }
    }
    const hit: Hit = {
      eventId: type === "event" ? (eventId as string) : null,
      id: newId("hit"),
      sid,
      test: isTest,
      ts: new Date().toISOString(),
      type,
      ua,
      url,
      vid,
      workspaceId: db.workspace.id,
    };
    db.hits.push(hit);
    save();
    res.status(201).json({ ok: true });
  });

  // E2E専用の観測境界。通常起動ではルート自体を登録しない。
  // ファイル保存ではなくメモリ上のread modelを返すため、collect受理直後から観測できる。
  if (environment.e2eObservationEnabled) {
    app.get("/api/e2e/observations/hits", (_req, res) => {
      res.json({ hits: db.hits });
    });
  }

  // ---- 管理系 API ----
  app.get("/api/workspace", (req, res) => {
    const origin = validateRequestOrigin(req.protocol, req.get("host"));
    if (!origin.ok) {
      sendApplicationError(res, origin.error);
      return;
    }
    res.json({
      demoUrl: environment.demoSiteUrl,
      endpoint: `${origin.value}/api/collect`,
      snippet: buildSnippet(origin.value, db.workspace.id),
      workspace: db.workspace,
    });
  });

  app.put("/api/workspace", (req, res) => {
    const input = validateWorkspaceInput(req.body);
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    db.workspace.name = input.value.name;
    save();
    res.json({ workspace: db.workspace });
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: db.events.map(eventView) });
  });

  app.post("/api/events", (req, res) => {
    const input = validateEventInput(
      req.body,
      new Set(db.labels.map((label) => label.id))
    );
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    const now = new Date().toISOString();
    const event: TrackEvent = {
      id: newId("ev"),
      workspaceId: db.workspace.id,
      ...input.value,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    db.events.push(event);
    save();
    res.status(201).json({ event: eventView(event) });
  });

  app.put("/api/events/:id", (req, res) => {
    const id = validateResourceId(req.params.id, "ev_");
    if (!id.ok) {
      sendApplicationError(res, id.error);
      return;
    }
    const event = db.events.find((e) => e.id === id.value);
    if (!event) {
      sendApplicationError(
        res,
        applicationError("not found", 404, "not_found")
      );
      return;
    }
    const input = validateEventInput(
      req.body,
      new Set(db.labels.map((label) => label.id))
    );
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    Object.assign(event, input.value, { updatedAt: new Date().toISOString() });
    save();
    res.json({ event: eventView(event) });
  });

  app.post("/api/events/:id/toggle", (req, res) => {
    const id = validateResourceId(req.params.id, "ev_");
    if (!id.ok) {
      sendApplicationError(res, id.error);
      return;
    }
    const input = validateToggleInput(req.body);
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    const event = db.events.find((e) => e.id === id.value);
    if (!event) {
      sendApplicationError(
        res,
        applicationError("not found", 404, "not_found")
      );
      return;
    }
    event.enabled = input.value.enabled;
    event.updatedAt = new Date().toISOString();
    save();
    res.json({ event: eventView(event) });
  });

  app.delete("/api/events/:id", (req, res) => {
    const id = validateResourceId(req.params.id, "ev_");
    if (!id.ok) {
      sendApplicationError(res, id.error);
      return;
    }
    const i = db.events.findIndex((e) => e.id === id.value);
    if (i === -1) {
      sendApplicationError(
        res,
        applicationError("not found", 404, "not_found")
      );
      return;
    }
    const [removed] = db.events.splice(i, 1);
    db.hits = db.hits.filter((h) => h.eventId !== removed.id);
    save();
    res.json({ ok: true });
  });

  // イベント単位のテスト発火(▷): 実際の受信経路(/api/collect)を通して
  // テストヒットを記録する。件数には含めない
  async function fireEventTest(
    res: express.Response,
    event: TrackEvent,
    requestOrigin: string
  ): Promise<void> {
    try {
      const r = await collectFetch(
        `http://localhost:${environment.port}/api/collect`,
        {
          body: JSON.stringify({
            ws: db.workspace.id,
            eventId: event.id,
            type: "event",
            url: `${requestOrigin}/admin (テスト発火)`,
            test: true,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      if (r.status !== 201) {
        throw transportError(`collect HTTP ${r.status}`, r);
      }
      res.json({
        message: `イベント「${event.name}」のテスト発火を記録しました(計測件数には含まれません)`,
        ok: true,
      });
    } catch (cause) {
      if (isBoundaryError(cause)) throw cause;
      throw transportError("collect request failed", cause);
    }
  }

  // Express 4 は async ハンドラの reject を自動処理しない(未捕捉だとプロセスクラッシュに
  // つながる)ため、ハンドラ本体は非 async にし、内部で await する処理は try/catch で回収する
  app.post("/api/events/:id/test", (req, res, next) => {
    const id = validateResourceId(req.params.id, "ev_");
    if (!id.ok) {
      sendApplicationError(res, id.error);
      return;
    }
    const event = db.events.find((e) => e.id === id.value);
    if (!event) {
      sendApplicationError(
        res,
        applicationError("not found", 404, "not_found")
      );
      return;
    }
    const origin = validateRequestOrigin(req.protocol, req.get("host"));
    if (!origin.ok) {
      sendApplicationError(res, origin.error);
      return;
    }
    void (async () => {
      try {
        await fireEventTest(res, event, origin.value);
      } catch (error) {
        next(error);
      }
    })();
  });

  // タグ設置の動作検証: since 以降に受信した pageview を返す
  app.get("/api/tag-check", (req, res) => {
    const input = validateTagCheckQuery(req.query);
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    const hits = db.hits.filter(
      (h) =>
        h.type === "pageview" &&
        !h.test &&
        new Date(h.ts).getTime() >= input.value.since
    );
    res.json({ count: hits.length, hits: hits.slice(-10) });
  });

  // ---- ラベル API ----
  app.get("/api/labels", (_req, res) => {
    const usage = new Map<string, number>();
    for (const e of db.events) {
      for (const id of e.labelIds) usage.set(id, (usage.get(id) ?? 0) + 1);
    }
    res.json({
      labels: db.labels.map((l) => ({
        ...l,
        eventCount: usage.get(l.id) ?? 0,
      })),
    });
  });

  app.post("/api/labels", (req, res) => {
    const input = validateLabelInput(req.body);
    if (!input.ok) {
      sendApplicationError(res, input.error);
      return;
    }
    const label = { ...input.value, id: newId("lb") };
    db.labels.push(label);
    save();
    res.status(201).json({ label });
  });

  app.delete("/api/labels/:id", (req, res) => {
    const id = validateResourceId(req.params.id, "lb_");
    if (!id.ok) {
      sendApplicationError(res, id.error);
      return;
    }
    const i = db.labels.findIndex((l) => l.id === id.value);
    if (i === -1) {
      sendApplicationError(
        res,
        applicationError("not found", 404, "not_found")
      );
      return;
    }
    db.labels.splice(i, 1);
    for (const e of db.events) {
      e.labelIds = e.labelIds.filter((labelId) => labelId !== id.value);
    }
    save();
    res.json({ ok: true });
  });

  // ---- レポート API: イベント×直近7日間の日別件数(count7d と同じ集計窓) ----
  app.get("/api/report", (_req, res) => {
    const days = last7LocalDays();
    const rows = db.events.map((e) => {
      const counts = dailyCounts(days, (h) => h.eventId === e.id && !h.test);
      return {
        counts,
        enabled: e.enabled,
        eventId: e.id,
        name: e.name,
        total: counts.reduce((a, b) => a + b, 0),
        trigger: e.trigger,
      };
    });
    const pageviews = dailyCounts(
      days,
      (h) => h.type === "pageview" && !h.test
    );
    res.json({ days, pageviews, rows });
  });

  // ---- 管理画面 ----
  app.get("/", (_req, res) => res.redirect("/admin"));
  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(ROOT, "public/admin.html"));
  });

  // application errorとtransport errorをHTTPへ変換する。
  // それ以外はunexpected errorとして詳細を公開せず、サーバー側へ記録する。
  app.use(boundaryErrorMiddleware);

  return app;
}

export function startTrackingServer(): void {
  createTrackingApp().listen(environment.port, () => {
    console.log(
      `管理画面(計測サーバー): http://localhost:${environment.port}/admin`
    );
  });
}
