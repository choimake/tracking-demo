import assert from "node:assert/strict";

import type { BrowserContext, Page } from "playwright";

import { createManagedE2eRuntime } from "./session.js";

interface FakeOptions {
  closeFails?: boolean;
  events: string[];
  unrouteFailsFor?: string;
}

function fakePage(options: FakeOptions, pageId: string): Page {
  return {
    on: () => undefined,
    route: async (pattern: string) => {
      options.events.push(`route:${pageId}:${pattern}`);
    },
    unroute: async (pattern: string) => {
      options.events.push(`unroute:${pageId}:${pattern}`);
      if (pattern === options.unrouteFailsFor) {
        throw new Error(`injected unroute failure: ${pattern}`);
      }
    },
  } as unknown as Page;
}

function fakeContextFactory(options: FakeOptions) {
  let contextIndex = 0;
  return async (): Promise<BrowserContext> => {
    const contextId = `context-${contextIndex++}`;
    let pageIndex = 0;
    return {
      addInitScript: async () => {
        options.events.push(`init:${contextId}`);
      },
      clearCookies: async () => undefined,
      close: async () => {
        options.events.push(`close:${contextId}`);
        if (options.closeFails) {
          throw new Error(`injected close failure: ${contextId}`);
        }
      },
      cookies: async () => [],
      newPage: async () =>
        fakePage(options, `${contextId}/page-${pageIndex++}`),
    } as unknown as BrowserContext;
  };
}

function runtimeOptions(options: FakeOptions) {
  return {
    browserName: "chromium" as const,
    contextFactory: fakeContextFactory(options),
    correlationId: "managed-session-regression",
    mobile: false,
    userAgent: "fake-agent",
  };
}

async function checkAllResourcesReleased(): Promise<void> {
  const events: string[] = [];
  const runtime = await createManagedE2eRuntime(runtimeOptions({ events }));
  const sibling = await runtime.session.newPage();
  await runtime.session.route(sibling, "**/outer", async () => undefined);
  await runtime.withSession(
    { initScripts: ["window.__managed = true"] },
    async (session) => {
      const second = await session.newPage();
      await session.route(session.page, "**/inner-a", async () => undefined);
      await session.route(second, "**/inner-b", async () => undefined);
    }
  );
  assert.deepEqual(runtime.resourceSnapshot(), {
    contexts: { generated: 2, released: 1 },
    pages: { generated: 4, released: 2 },
    routes: { generated: 3, released: 2 },
  });
  await runtime.close();
  assert.deepEqual(runtime.resourceSnapshot(), {
    contexts: { generated: 2, released: 2 },
    pages: { generated: 4, released: 4 },
    routes: { generated: 3, released: 3 },
  });
  assert(events.indexOf("unroute:context-1/page-0:**/inner-a") >= 0);
  assert(
    events.indexOf("unroute:context-1/page-1:**/inner-b") <
      events.indexOf("close:context-1")
  );
  console.log("managed session success: contexts/pages/routes released");
}

async function checkCallbackFailureStillCleans(): Promise<void> {
  const events: string[] = [];
  const runtime = await createManagedE2eRuntime(runtimeOptions({ events }));
  await assert.rejects(
    runtime.withSession({}, async (session) => {
      await session.route(
        session.page,
        "**/callback-error",
        async () => undefined
      );
      throw new Error("injected callback failure");
    }),
    /injected callback failure/
  );
  assert(events.includes("unroute:context-1/page-0:**/callback-error"));
  assert(events.includes("close:context-1"));
  await runtime.close();
  console.log("managed session callback failure: cleanup completed");
}

async function checkRouteLeakDetectedAndAllCleanupAttempted(): Promise<void> {
  const events: string[] = [];
  const runtime = await createManagedE2eRuntime(
    runtimeOptions({ events, unrouteFailsFor: "**/fail" })
  );
  await assert.rejects(
    runtime.withSession({}, async (session) => {
      await session.route(session.page, "**/fail", async () => undefined);
      await session.route(session.page, "**/ok", async () => undefined);
    }),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.match(error.message, /managed session cleanup/);
      assert.match(String(error.errors), /資源リーク/);
      return true;
    }
  );
  assert(events.includes("unroute:context-1/page-0:**/fail"));
  assert(events.includes("unroute:context-1/page-0:**/ok"));
  assert(events.includes("close:context-1"));
  await assert.rejects(runtime.close(), (error: unknown) => {
    assert(error instanceof AggregateError);
    assert.match(String(error.errors), /生成数と解放数が不一致/);
    return true;
  });
  console.log(
    "managed session route leak: detected after all cleanup attempts"
  );
}

async function checkContextLeakDetected(): Promise<void> {
  const events: string[] = [];
  const runtime = await createManagedE2eRuntime(
    runtimeOptions({ closeFails: true, events })
  );
  await assert.rejects(runtime.close(), (error: unknown) => {
    assert(error instanceof AggregateError);
    const cleanupError = error.errors[0];
    assert(cleanupError instanceof AggregateError);
    assert.match(String(cleanupError.errors), /BrowserContextのclose/);
    assert.match(String(error.errors), /contextsの生成数と解放数が不一致/);
    assert.match(String(error.errors), /pagesの生成数と解放数が不一致/);
    return true;
  });
  assert.deepEqual(runtime.resourceSnapshot(), {
    contexts: { generated: 1, released: 0 },
    pages: { generated: 1, released: 0 },
    routes: { generated: 0, released: 0 },
  });
  console.log(
    "managed session context leak: generated/released mismatch detected"
  );
}

async function checkPageSetupRollback(): Promise<void> {
  const events: string[] = [];
  await assert.rejects(
    createManagedE2eRuntime({
      browserName: "chromium",
      contextFactory: async () =>
        ({
          close: async () => {
            events.push("rollback-context");
          },
          newPage: async () => {
            throw new Error("injected page setup failure");
          },
        }) as unknown as BrowserContext,
      correlationId: "managed-session-rollback",
      mobile: false,
      userAgent: "fake-agent",
    }),
    /injected page setup failure/
  );
  assert.deepEqual(events, ["rollback-context"]);
  console.log("managed session setup failure: context rollback completed");
}

await checkAllResourcesReleased();
await checkCallbackFailureStillCleans();
await checkRouteLeakDetectedAndAllCleanupAttempted();
await checkContextLeakDetected();
await checkPageSetupRollback();
