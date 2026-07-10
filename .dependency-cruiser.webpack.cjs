/** dependency-cruiser 用の最小 webpack resolve 設定 */
module.exports = {
  resolve: {
    extensions: [".ts", ".js", ".mjs", ".cjs", ".json"],
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    },
  },
};
