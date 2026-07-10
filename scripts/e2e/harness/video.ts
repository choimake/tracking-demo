import fs from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import type { RecordVideoMode } from "./config.js";

/** context close 後に動画を確定し、モードに応じて残す/削除する */
export async function finalizeScenarioVideo(options: {
  page: Page;
  mode: RecordVideoMode;
  ok: boolean;
  videoPath: string;
}): Promise<void> {
  const logUnavailable = (reason: string): void => {
    if (!options.ok) {
      console.error(`  video: (unavailable) ${reason}`);
    }
  };

  const video = options.page.video();
  if (!video) {
    logUnavailable("page.video() is null");
    return;
  }
  const originalPath = await video.path().catch(() => null);
  if (!originalPath) {
    logUnavailable("video.path() failed or empty");
    return;
  }
  if (options.mode === "on-failure" && options.ok) {
    await fs.unlink(originalPath).catch(() => {});
    return;
  }
  await fs.rm(options.videoPath, { force: true }).catch(() => {});
  try {
    await fs.rename(originalPath, options.videoPath);
  } catch {
    try {
      await fs.copyFile(originalPath, options.videoPath);
      await fs.unlink(originalPath).catch(() => {});
    } catch (error) {
      logUnavailable(
        `failed to move video to ${options.videoPath}: ${String(error)}`
      );
      return;
    }
  }
  if (!options.ok) {
    console.error(`  video: ${path.resolve(options.videoPath)}`);
  }
}
