import { defineConfig } from "vite";
import { codeInspectorPlugin } from "code-inspector-plugin";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/__mock_ui/" : "/",
  plugins: [
    vue(),
    codeInspectorPlugin({
      bundler: "vite",
      dev: command === "serve",
    }),
  ],
  root: "packages/mock-console/web",
  server: {
    host: "0.0.0.0",
    port: 22334,
    proxy: { "/__mock_admin": "http://127.0.0.1:22333" },
  },
  build: { outDir: "../dist", emptyOutDir: true },
}));
