// tracker.js(計測スクリプト)の実ブラウザ検証のエントリ。
// 実行: npm run e2e (npm start で両サーバーが起動していること)
// Chromium / Firefox / WebKit を直列実行する(共有 db.json のため並列禁止)
import fs from "node:fs/promises";
import path from "node:path";

import { chromium, firefox, webkit } from "playwright";

import type { BrowserName } from "./harness/config.js";
import {
  e2eVideoDir,
  isE2eMobile,
  parseE2eBrowsers,
  parseRecordVideoMode,
  toScenarioSlug,
} from "./harness/config.js";
import { E2eRunner } from "./harness/runner.js";
import {
  setupE2eFixtures,
  teardownE2eFixtures,
  createE2eSession,
} from "./harness/session.js";
import type { E2eContext } from "./harness/types.js";
import { finalizeScenarioVideo } from "./harness/video.js";
import { e2eScenarios } from "./scenarios.js";
import { TrackingClient } from "./tracking/client.js";

const BROWSERS: Record<
  BrowserName,
  typeof chromium | typeof firefox | typeof webkit
> = {
  chromium,
  firefox,
  webkit,
};

async function main(): Promise<void> {
  const tracking = new TrackingClient();
  const fixtures = await setupE2eFixtures(tracking);
  const runner = new E2eRunner();
  const recordVideoMode = parseRecordVideoMode();
  const mobile = isE2eMobile();
  const browserOrder = parseE2eBrowsers();

  try {
    for (const browserName of browserOrder) {
      const deviceLabel = mobile ? `${browserName}:mobile` : browserName;
      console.log(`\n===== browser: ${deviceLabel} =====`);
      const browser = await BROWSERS[browserName].launch();
      try {
        if (recordVideoMode) {
          // 録画時はシナリオごとに context を開閉する(close 時に webm が確定するため)
          const videoDir = e2eVideoDir(browserName);
          await fs.mkdir(videoDir, { recursive: true });

          for (const scenario of e2eScenarios) {
            const videoPath = path.join(
              videoDir,
              `${toScenarioSlug(scenario.name)}.webm`
            );
            const session = await createE2eSession(browser, {
              browserName,
              mobile,
              recordVideoDir: videoDir,
            });
            const ctx: E2eContext = {
              browser,
              browserName,
              fixtures,
              mobile,
              page: session.page,
              recordVideoDir: videoDir,
              scenarioVideoPath: videoPath,
              trackerLogs: session.trackerLogs,
              tracking: session.tracking,
            };

            // run 前は false 相当。想定外例外でも context を閉じる
            let ok = false;
            try {
              ok = await runner.runE2eCase(
                `[${deviceLabel}] ${scenario.name}`,
                () => scenario.run(ctx)
              );
            } finally {
              try {
                await session.context.close();
              } catch (error) {
                console.error(`  context.close failed: ${String(error)}`);
              }
              // シナリオが既に scenarioVideoPath へ動画を確定済みなら外側 finalize しない
              const alreadyPromoted = await fs
                .access(videoPath)
                .then(() => true)
                .catch(() => false);
              if (!alreadyPromoted) {
                await finalizeScenarioVideo({
                  mode: recordVideoMode,
                  ok,
                  page: session.page,
                  videoPath,
                });
              } else {
                // 内側が scenarioVideoPath を確定済み。外側の空録画だけ捨てる
                const outerVideo = session.page.video();
                if (outerVideo) {
                  const outerPath = await outerVideo.path().catch(() => null);
                  if (outerPath && outerPath !== videoPath) {
                    await fs.unlink(outerPath).catch(() => {});
                  }
                }
                if (recordVideoMode === "on-failure" && ok) {
                  await fs.unlink(videoPath).catch(() => {});
                } else if (!ok) {
                  console.error(`  video: ${path.resolve(videoPath)}`);
                }
              }
            }
          }
        } else {
          // フラグなし: 速度優先でブラウザごとに page を共有
          const session = await createE2eSession(browser, {
            browserName,
            mobile,
          });
          const ctx: E2eContext = {
            browser,
            browserName,
            fixtures,
            mobile,
            page: session.page,
            trackerLogs: session.trackerLogs,
            tracking: session.tracking,
          };

          try {
            for (const scenario of e2eScenarios) {
              await runner.runE2eCase(`[${deviceLabel}] ${scenario.name}`, () =>
                scenario.run(ctx)
              );
            }
          } finally {
            try {
              await session.context.close();
            } catch (error) {
              console.error(`  context.close failed: ${String(error)}`);
            }
          }
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    await teardownE2eFixtures(tracking, fixtures);
  }

  runner.printSummary();
  process.exit(runner.exitCode);
}

main();
