# 架构索引

## 范围地图

- **workspace**：mockJson，Node.js 单仓库应用。
- **server**：`apps/server/src/`，Fastify 管理 API、规则匹配、透明代理与 JSON 文件持久化。
- **web**：`apps/web/src/`，Vue 3 + TypeScript 控制台。

## 边界与入口

| 范围 | 职责 | 代码锚点 |
| --- | --- | --- |
| server/storage | 解析用户数据目录，校验配置、串行原子保存并从有效备份恢复 | `apps/server/src/state-path.ts` `apps/server/src/storage.ts` `JsonFileRepository` |
| server/validation | 管理 API 与持久化共用的数据边界校验 | `apps/server/src/validation.ts` |
| server/matcher | 无 IO 的 Header / URL / Method 规则计算 | `apps/server/src/matcher.ts` `matchApi` |
| server/proxy | 当前包匹配、Mock 返回和未命中流式转发 | `apps/server/src/proxy.ts` `createProxy` |
| server/routes | `/__mock_admin/*` 管理接口、本机访问边界及单进程启动 | `apps/server/src/index.ts` |
| web | `App.vue` 页面组合，`useMockConsole.ts` 状态与 CRUD，`App.css` 样式 | `apps/web/src/` |

## 运行与数据

- `npm run dev` 同时启动 Vite 开发页面（22334）与 Fastify Mock / Proxy 服务（22333）；`npm run build && npm start` 由 Fastify 在 22333 提供页面、管理 API 和 Mock / Proxy。
- 正式使用只需访问 `http://127.0.0.1:22333`；Package 的 `targetBaseUrl` 仅用于未命中时转发真实服务，不默认占用 22333。
- 配置文件默认保存在当前用户数据目录（Windows `%LOCALAPPDATA%\mock-console\state.json`，macOS `~/Library/Application Support/mock-console/state.json`，Linux `$XDG_DATA_HOME/mock-console/state.json` 或 `~/.local/share/mock-console/state.json`），也可由 `MOCK_STATE_FILE` 覆盖；仓库只保留脱敏的 `data/mock-data.example.json` 示例。主文件损坏时只恢复结构有效的 `.bak`，主文件和备份均损坏则拒绝启动；构建产物为被忽略的 `dist/`。
