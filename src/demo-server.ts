import fs from "node:fs";
import path from "node:path";

// 「顧客LP」役の静的サイトサーバー。計測サーバーとは別ポート=別オリジンで配信する。
// demo-site/ 配下は素の HTML で、<head> に管理画面からコピーした計測タグが貼ってあるだけ。
import express from "express";

import { ROOT } from "./paths.js";

const SITE_PORT = Number(process.env.SITE_PORT ?? 3200);
const TRACKING_ORIGIN =
  process.env.TRACKING_ORIGIN ?? `http://localhost:${process.env.PORT ?? 3100}`;
const SITE_DIR = path.join(ROOT, "demo-site");
const DEFAULT_TRACKING_ORIGIN = "http://localhost:3100";

function rewriteTrackingOrigin(html: string): string {
  return html.replaceAll(DEFAULT_TRACKING_ORIGIN, TRACKING_ORIGIN);
}

function sendRewrittenHtml(res: express.Response, filePath: string): void {
  const html = fs.readFileSync(filePath, "utf8");
  res.type("html").send(rewriteTrackingOrigin(html));
}

function resolveHtmlFile(urlPath: string): string | null {
  const candidates: string[] = [];
  if (urlPath === "/" || urlPath === "") {
    candidates.push(path.join(SITE_DIR, "index.html"));
  } else {
    const rel = urlPath.replace(/^\//, "");
    candidates.push(path.join(SITE_DIR, rel));
    if (!path.extname(rel)) {
      candidates.push(path.join(SITE_DIR, `${rel}.html`));
    }
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(SITE_DIR + path.sep) && resolved !== SITE_DIR) {
      continue;
    }
    if (
      resolved.endsWith(".html") &&
      fs.existsSync(resolved) &&
      fs.statSync(resolved).isFile()
    ) {
      return resolved;
    }
  }
  return null;
}

const app = express();

// HTML は計測オリジンを置換して配信(未設定時は localhost:3100 のまま)
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  if (/^\/spa(\/.*)?$/.test(req.path)) {
    next();
    return;
  }
  const htmlFile = resolveHtmlFile(req.path);
  if (!htmlFile) {
    next();
    return;
  }
  sendRewrittenHtml(res, htmlFile);
});

// CSS 等の非 HTML アセット
app.use(express.static(SITE_DIR));

// SPA のディープリンク(/spa/pricing 等)は spa.html にフォールバック
// (実際の静的ホスティングの rewrite 設定に相当)
app.get(/^\/spa(\/.*)?$/, (_req, res) => {
  sendRewrittenHtml(res, path.join(SITE_DIR, "spa.html"));
});

app.listen(SITE_PORT, () => {
  console.log(`デモサイト(顧客LP役): http://localhost:${SITE_PORT}/`);
});
