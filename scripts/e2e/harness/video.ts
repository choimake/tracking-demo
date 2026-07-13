import fs from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import type { RecordVideoMode } from "./config.js";

function videoMoveError(
  videoPath: string,
  renameError: unknown,
  copyError: unknown
): AggregateError {
  return new AggregateError(
    [renameError, copyError],
    `failed to move video to ${videoPath}: ` +
      `${String(renameError)} | ${String(copyError)}`,
    { cause: copyError }
  );
}

/** 既に確定した動画を優先し、外側の動画を確定または削除する。 */
export async function finalizeOrDiscardVideo(options: {
  mode: RecordVideoMode;
  ok: boolean;
  page: Page;
  videoPath: string;
}): Promise<void> {
  const alreadyPromoted = await fs
    .access(options.videoPath)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (!alreadyPromoted) {
    await finalizeScenarioVideo(options);
    return;
  }

  const outerVideo = options.page.video();
  if (outerVideo) {
    const outerPath = await outerVideo.path();
    if (outerPath && outerPath !== options.videoPath) {
      await fs.rm(outerPath, { force: true });
    }
  }
  if (options.mode === "on-failure" && options.ok) {
    await fs.rm(options.videoPath, { force: true });
  } else if (!options.ok) {
    console.error(`  video: ${path.resolve(options.videoPath)}`);
  }
}

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
    const error = new Error("page.video() is null");
    logUnavailable(error.message);
    throw error;
  }
  const originalPath = await video.path();
  if (!originalPath) {
    const error = new Error("video.path() is empty");
    logUnavailable(error.message);
    throw error;
  }
  if (options.mode === "on-failure" && options.ok) {
    await fs.rm(originalPath, { force: true });
    return;
  }
  await fs.rm(options.videoPath, { force: true });
  try {
    await fs.rename(originalPath, options.videoPath);
  } catch (renameError) {
    try {
      await fs.copyFile(originalPath, options.videoPath);
      await fs.rm(originalPath, { force: true });
    } catch (copyError) {
      const error = videoMoveError(options.videoPath, renameError, copyError);
      logUnavailable(error.message);
      throw error;
    }
  }
  if (!options.ok) {
    console.error(`  video: ${path.resolve(options.videoPath)}`);
  }
}
