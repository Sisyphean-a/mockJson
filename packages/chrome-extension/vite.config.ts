import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const packageRoot = resolve(process.cwd(), "packages/chrome-extension");

function verifyContentScriptBundle() {
  return {
    name: "verify-content-script-bundle",
    closeBundle() {
      for (const name of ["content-main", "content-bridge", "blocking-console-bridge"]) {
        const source = readFileSync(resolve(packageRoot, `dist/${name}.js`), "utf8");
        if (/(?:^|;)import\s*["'{*]/m.test(source) || /(?:^|;)export\s*[\w{*]/m.test(source)) {
          throw new Error(`${name}.js 必须是自包含的普通脚本，不能包含 import/export`);
        }
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
        "blocking-console-bridge": resolve(packageRoot, "src/blocking-console-bridge.ts"),
        "blocking-manager": resolve(packageRoot, "src/blocking-manager.ts"),
        "service-worker": resolve(packageRoot, "src/service-worker.ts"),
        popup: resolve(packageRoot, "src/popup.ts"),
        panel: resolve(packageRoot, "src/panel.ts"),
        devtools: resolve(packageRoot, "src/devtools.ts"),
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
