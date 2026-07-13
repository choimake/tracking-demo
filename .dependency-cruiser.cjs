/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "循環依存は禁止(型だけの import は除外)",
      from: {},
      to: {
        circular: true,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "どこからも参照されないモジュール",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)main\\.ts$",
          "(^|/)run\\.ts$",
          "(^|/)run-bench\\.ts$",
          "(^|/)suite-worker\\.ts$",
          "(^|/)scripts/mutation/run\\.ts$",
          "\\.d\\.ts$",
          "(^|/)gamp\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "本番コードから devDependency への依存は禁止",
      from: { path: "^src", pathNot: "\\.test\\.|\\.spec\\." },
      to: {
        dependencyTypes: ["npm-dev"],
        pathNot: "node_modules/@types/",
      },
    },
    {
      name: "e2e-browser-not-to-tracking",
      severity: "error",
      comment: "browser は tracking に依存しない",
      from: { path: "^scripts/e2e/browser" },
      to: { path: "^scripts/e2e/tracking" },
    },
    {
      name: "e2e-browser-module-direction",
      severity: "error",
      comment: "browser の下位責務は相互依存せず、barrel に逆依存しない",
      from: {
        path: "^scripts/e2e/browser/(navigation|history|cookie|failure-injection)(?:\\.ts|/)",
      },
      to: {
        path: "^scripts/e2e/browser/(navigation|history|cookie|input|failure-injection|index)\\.ts$",
      },
    },
    {
      name: "e2e-browser-input-direction",
      severity: "error",
      comment: "input は navigation だけを下位責務として利用できる",
      from: { path: "^scripts/e2e/browser/input(?:\\.ts|/)" },
      to: {
        path: "^scripts/e2e/browser/(history|cookie|failure-injection|index)\\.ts$",
      },
    },
    {
      name: "e2e-tests-browser-barrel-import",
      severity: "error",
      comment: "tests から browser への import は barrel に限定する",
      from: { path: "^scripts/e2e/tests/" },
      to: {
        path: "^scripts/e2e/browser/",
        pathNot: "^scripts/e2e/browser/index\\.ts$",
      },
    },
    {
      name: "e2e-tests-tracking-barrel-import",
      severity: "error",
      comment: "tests から tracking への import は barrel に限定する",
      from: { path: "^scripts/e2e/tests/" },
      to: {
        path: "^scripts/e2e/tracking/",
        pathNot: "^scripts/e2e/tracking/index\\.ts$",
      },
    },
    {
      name: "e2e-browser-not-to-tests",
      severity: "error",
      comment: "browser は tests に依存しない",
      from: { path: "^scripts/e2e/browser" },
      to: { path: "^scripts/e2e/tests" },
    },
    {
      name: "e2e-tracking-not-to-browser",
      severity: "error",
      comment: "tracking は browser に依存しない",
      from: { path: "^scripts/e2e/tracking" },
      to: { path: "^scripts/e2e/browser" },
    },
    {
      name: "e2e-tracking-not-to-tests",
      severity: "error",
      comment: "tracking は tests に依存しない",
      from: { path: "^scripts/e2e/tracking" },
      to: { path: "^scripts/e2e/tests" },
    },
    {
      name: "e2e-tracking-only-harness-config",
      severity: "error",
      comment: "tracking が依存できる harness は config のみ",
      from: { path: "^scripts/e2e/tracking" },
      to: {
        path: "^scripts/e2e/harness",
        pathNot: "^scripts/e2e/harness/config",
      },
    },
    {
      name: "e2e-tracking-response-parser-is-leaf",
      severity: "error",
      comment: "response parser は他の tracking モジュールに依存しない",
      from: {
        path: "^scripts/e2e/tracking/response-parser(?:\\.ts|/)",
      },
      to: {
        path: "^scripts/e2e/tracking/(transport|admin-api|observation-api|client|polling|count-assertions|hit-payload-assertions|log-assertions|assertion-formatter|index)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-transport-direction",
      severity: "error",
      comment: "transport は API・assertion・client に逆依存しない",
      from: { path: "^scripts/e2e/tracking/transport(?:\\.ts|/)" },
      to: {
        path: "^scripts/e2e/tracking/(admin-api|observation-api|client|polling|count-assertions|hit-payload-assertions|log-assertions|index)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-admin-api-direction",
      severity: "error",
      comment: "admin API は observation・client・assertion に逆依存しない",
      from: { path: "^scripts/e2e/tracking/admin-api(?:\\.ts|/)" },
      to: {
        path: "^scripts/e2e/tracking/(observation-api|client|polling|count-assertions|hit-payload-assertions|log-assertions|index)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-observation-api-direction",
      severity: "error",
      comment: "observation API は admin・client・assertion に逆依存しない",
      from: {
        path: "^scripts/e2e/tracking/observation-api(?:\\.ts|/)",
      },
      to: {
        path: "^scripts/e2e/tracking/(admin-api|client|polling|count-assertions|hit-payload-assertions|log-assertions|index)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-client-not-to-assertions",
      severity: "error",
      comment: "client facade は assertion 層に依存しない",
      from: { path: "^scripts/e2e/tracking/client(?:\\.ts|/)" },
      to: {
        path: "^scripts/e2e/tracking/(polling|count-assertions|hit-payload-assertions|log-assertions|fire-assertion-helper|index)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-fire-assertion-helper-direction",
      severity: "error",
      comment: "下位tracking責務は発火検証helperへ逆依存しない",
      from: {
        path: "^scripts/e2e/tracking/(response-parser|transport|admin-api|observation-api|client|assertion-formatter|polling|count-assertions|hit-payload-assertions|log-assertions)(?:\\.ts|/)",
      },
      to: {
        path: "^scripts/e2e/tracking/fire-assertion-helper\\.ts$",
      },
    },
    {
      name: "e2e-tracking-assertion-direction",
      severity: "error",
      comment: "assertion は polling から count、Hit payload への一方向にする",
      from: {
        path: "^scripts/e2e/tracking/(assertion-formatter|polling|count-assertions|hit-payload-assertions|log-assertions)(?:\\.ts|/)",
      },
      to: {
        path: "^scripts/e2e/tracking/(index|hit-payload-assertions)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-assertion-formatter-is-leaf",
      severity: "error",
      comment: "assertion formatter は他の assertion モジュールに依存しない",
      from: {
        path: "^scripts/e2e/tracking/assertion-formatter(?:\\.ts|/)",
      },
      to: {
        path: "^scripts/e2e/tracking/(polling|count-assertions|hit-payload-assertions|log-assertions)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-polling-not-to-count-or-log",
      severity: "error",
      comment: "polling は count と log に逆依存しない",
      from: { path: "^scripts/e2e/tracking/polling(?:\\.ts|/)" },
      to: {
        path: "^scripts/e2e/tracking/(count-assertions|log-assertions)\\.ts$",
      },
    },
    {
      name: "e2e-tracking-log-not-to-count",
      severity: "error",
      comment: "log assertion は count assertion に依存しない",
      from: { path: "^scripts/e2e/tracking/log-assertions(?:\\.ts|/)" },
      to: { path: "^scripts/e2e/tracking/count-assertions\\.ts$" },
    },
    {
      name: "e2e-tracking-count-not-to-log",
      severity: "error",
      comment: "count assertion は log assertion に依存しない",
      from: {
        path: "^scripts/e2e/tracking/count-assertions(?:\\.ts|/)",
      },
      to: { path: "^scripts/e2e/tracking/log-assertions\\.ts$" },
    },
    {
      name: "e2e-tracking-hit-payload-not-to-log",
      severity: "error",
      comment: "Hit payload assertion は log assertion に依存しない",
      from: {
        path: "^scripts/e2e/tracking/hit-payload-assertions(?:\\.ts|/)",
      },
      to: { path: "^scripts/e2e/tracking/log-assertions\\.ts$" },
    },
    {
      name: "e2e-harness-not-to-browser",
      severity: "error",
      comment: "harness は browser に依存しない",
      from: { path: "^scripts/e2e/harness" },
      to: { path: "^scripts/e2e/browser" },
    },
    {
      name: "e2e-harness-not-to-tests",
      severity: "error",
      comment: "harness は tests に依存しない",
      from: { path: "^scripts/e2e/harness" },
      to: { path: "^scripts/e2e/tests" },
    },
    {
      name: "e2e-harness-leaf-not-to-tracking",
      severity: "error",
      comment: "harness の config/video は tracking に依存しない",
      from: { path: "^scripts/e2e/harness/(config|video)" },
      to: { path: "^scripts/e2e/tracking" },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules"],
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    // NodeNext の `import './foo.js'` → `foo.ts` を解決するため
    webpackConfig: {
      fileName: ".dependency-cruiser.webpack.cjs",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
