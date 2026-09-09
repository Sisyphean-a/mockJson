import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const packageRoot = resolve(process.cwd(), "packages/chrome-extension");

function verifyContentScriptBundle() {
  return {
    name: "verify-content-script-bundle",
    closeBundle() {
      const contentMain = readFileSync(resolve(packageRoot, "dist/content-main.js"), "utf8");
      if (/(?:^|;)import(?:\\s|\\{)/.test(contentMain) || /(?:^|;)export(?:\\s|\\{)/.test(contentMain)) {
        throw new Error("content-main.js 必须是自包含的普通脚本，不能包含 import/export");
      }
    },
  };
}

export default defineConfig({
  plugins: [verifyContentScriptBundle()],
  root: packageRoot,
  publicDir: resolve(packageRoot, "public"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "content-main": resolve(packageRoot, "src/content-main.ts"),
        "content-bridge": resolve(packageRoot, "src/content-bridge.ts"),
        "service-worker": resolve(packageRoot, "src/service-worker.ts"),
        popup: resolve(packageRoot, "src/popup.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
