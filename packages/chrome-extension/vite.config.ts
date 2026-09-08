import { resolve } from "node:path";
import { defineConfig } from "vite";

const packageRoot = resolve(process.cwd(), "packages/chrome-extension");

export default defineConfig({
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
