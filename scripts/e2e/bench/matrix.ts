import type { BrowserName } from "../harness/config.js";

export type BenchMode = "serial" | "parallel";

export interface BenchCell {
  id: string;
  mode: BenchMode;
  browsers: BrowserName[];
}

/** ベンチ対象の5セル。serial は1スタック直列、parallel はブラウザ単位プロセス隔離 */
export const BENCH_MATRIX: BenchCell[] = [
  { id: "serial-chromium", mode: "serial", browsers: ["chromium"] },
  {
    id: "serial-chromium-firefox",
    mode: "serial",
    browsers: ["chromium", "firefox"],
  },
  {
    id: "serial-chromium-firefox-webkit",
    mode: "serial",
    browsers: ["chromium", "firefox", "webkit"],
  },
  {
    id: "parallel-chromium-firefox",
    mode: "parallel",
    browsers: ["chromium", "firefox"],
  },
  {
    id: "parallel-chromium-firefox-webkit",
    mode: "parallel",
    browsers: ["chromium", "firefox", "webkit"],
  },
];

export function findCell(id: string): BenchCell | undefined {
  return BENCH_MATRIX.find((c) => c.id === id);
}
