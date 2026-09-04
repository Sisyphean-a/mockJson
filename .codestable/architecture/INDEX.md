# 架构索引

## 范围地图

- **workspace**：mockJson，Node.js 单仓库应用。
- **server**：`apps/server/src/`，Fastify 管理 API、规则匹配、透明代理与 JSON 文件持久化。
- **web**：`apps/web/src/`，Vue 3 + TypeScript 控制台。

## 边界与入口

| 范围 | 职责 | 代码锚点 |
| --- | --- | --- |
| server/bootstrap | Fastify 组合根、启动、CORS、静态页面和请求访问边界 | `apps/server/src/index.ts` |
| server/config | Package / Logical API / Scenario 的业务变更、查找、状态归一化和持久化回滚 | `apps/server/src/config-service.ts` `MockConfigService` |
| server/routes | `/__mock_admin/*` HTTP 参数转换、错误状态和响应转换 | `apps/server/src/admin-routes.ts` `registerAdminRoutes` |
| server/storage | 解析用户数据目录，校验配置、串行原子保存并从有效备份恢复 | `apps/server/src/state-path.ts` `apps/server/src/storage.ts` `JsonFileRepository` |
| server/validation | 管理 API 与持久化共用的数据边界校验 | `apps/server/src/validation.ts` |
| server/matcher | 无 IO 的 Header / URL / Method 规则计算 | `apps/server/src/matcher.ts` `matchApi` |
| server/proxy | 当前包匹配、Mock 返回和未命中流式转发 | `apps/server/src/proxy.ts` `createProxy` |
| shared/contracts | 前后端共用的 Mock 领域数据类型 | `apps/shared/types.ts` |
| web/runtime | 开发与正式运行的服务端口、管理请求地址和页面展示地址策略 | `apps/web/src/runtime-endpoints.ts` `createRuntimeEndpoints` |
| web/client | 浏览器 HTTP 传输接缝、管理 API 请求、响应和连接错误转换 | `apps/web/src/mock-admin-client.ts` `AdminTransport` `MockAdminClient` |
| web/state | 页面状态、当前选择、派生查询、服务端加载和管理请求可用状态 | `apps/web/src/use-mock-state.ts` `useMockState` `runAdminRequest` |
| web/forms | 表单草稿和编辑器状态，不执行领域请求 | `apps/web/src/use-console-forms.ts` `useConsoleForms` |
| web/actions | 按 Package、API、Scenario 变化原因组织的用户动作 | `apps/web/src/use-package-actions.ts` `usePackageActions` `apps/web/src/use-api-actions.ts` `useApiActions` `apps/web/src/use-scenario-actions.ts` `useScenarioActions` |
| web/views | 页面组合根、唯一启动状态展示与独立区域视图 | `apps/web/src/App.vue` `apps/web/src/components/` |

## 运行与数据

- `npm run dev` 同时启动 Vite 开发页面（22334）与 Fastify Mock / Proxy 服务（22333）；`npm run build && npm start` 由 Fastify 在 22333 提供页面、管理 API 和 Mock / Proxy。
- 正式使用只需访问 `http://127.0.0.1:22333`；Package 的 `targetBaseUrl` 仅用于未命中时转发真实服务，不默认占用 22333。
- 配置文件默认保存在当前用户数据目录（Windows `%LOCALAPPDATA%\mock-console\state.json`，macOS `~/Library/Application Support/mock-console/state.json`，Linux `$XDG_DATA_HOME/mock-console/state.json` 或 `~/.local/share/mock-console/state.json`），也可由 `MOCK_STATE_FILE` 覆盖；仓库只保留脱敏的 `data/mock-data.example.json` 示例。主文件损坏时只恢复结构有效的 `.bak`，主文件和备份均损坏则拒绝启动；构建产物为被忽略的 `dist/`。
- 管理配置变更由 `MockConfigService` 统一拥有，路由不得直接修改 `State`；前端运行地址由 `createRuntimeEndpoints` 统一计算，浏览器调用细节由 `AdminTransport` 吸收，所有管理请求的可用状态由 `useMockState.runAdminRequest` 唯一维护；`App.vue` 只组合区域并唯一展示启动状态，不实现领域操作。