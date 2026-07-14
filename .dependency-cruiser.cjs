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
