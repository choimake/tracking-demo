import path from "node:path";
import { fileURLToPath } from "node:url";

// パス解決だけの副作用なしモジュール。
// (db.ts に置くと import しただけで DB のロード・シードが走るため分離)
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
