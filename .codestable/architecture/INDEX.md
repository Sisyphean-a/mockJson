# 架构索引

## 范围地图

- **workspace**：mockJson，Node.js 单仓库应用。
- **server**：`apps/server/src/`，Fastify 管理 API、规则匹配、透明代理与 JSON 文件持久化。
- **web**：`apps/web/src/`，Vue 3 + TypeScript 控制台。

## 边界与入口

| 范围 | 职责 | 代码锚点 |
| --- | --- | --- |
| server/storage | 原子读取与保存本地配置 | `apps/server/src/storage.ts` `JsonFileRepository` |
| server/matcher | 无 IO 的 Header / URL 规则计算 | `apps/server/src/matcher.ts` `matchApi` |
| server/proxy | 当前包匹配、Mock 返回和未命中流式转发 | `apps/server/src/proxy.ts` `createProxy` |
| server/routes | `/__mock_admin/*` 管理接口及单进程启动 | `apps/server/src/index.ts` |
| web | 包、逻辑接口、场景切换与 JSON 草稿编辑 | `apps/web/src/App.vue` |

## 运行与数据

- `npm run dev` 同时启动 Vite 开发页面（22334）与 Fastify Mock / Proxy 服务（22333）；`npm run build && npm start` 由 Fastify 在 22333 提供页面、管理 API 和 Mock / Proxy。
- 正式使用只需访问 `http://127.0.0.1:22333`；Package 的 `targetBaseUrl` 仅用于未命中时转发真实服务，不默认占用 22333。
- 配置文件为 `data/mock-data.json`；构建产物为被忽略的 `dist/`。
