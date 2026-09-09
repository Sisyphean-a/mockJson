# 架构索引

## 范围地图

- **workspace**：mockJson，Node.js 单仓库、npm workspaces。
- **package:mock-console**：`packages/mock-console/`，本地 Mock / Proxy 控制台，包含 Fastify 服务、Vue 管理页面和共享领域契约。
- **package:chrome-extension**：`packages/chrome-extension/`，Chrome Manifest V3 扩展，只负责页面 fetch / 异步 XMLHttpRequest 的拦截桥接，不持有 Mock 配置。

## 包边界与入口

| 范围 | 职责 | 代码锚点 |
| --- | --- | --- |
| package:mock-console/server/bootstrap | Fastify 组合根、启动、CORS、静态页面、loopback 管理/扩展接口和请求访问边界 | `packages/mock-console/server/src/index.ts` |
| package:mock-console/server/config | Package / Logical API / Scenario 的业务变更、查找、状态归一化和持久化回滚 | `packages/mock-console/server/src/config-service.ts` `MockConfigService` |
| package:mock-console/server/routes | 管理 API 与扩展判定 API 的 HTTP 参数转换、错误状态和响应转换 | `packages/mock-console/server/src/admin-routes.ts` `packages/mock-console/server/src/extension-routes.ts` |
| package:mock-console/server/storage | 解析用户数据目录，校验配置、串行原子保存并从有效备份恢复 | `packages/mock-console/server/src/state-path.ts` `packages/mock-console/server/src/storage.ts` |
| package:mock-console/server/validation | 管理 API 与持久化共用的数据边界校验 | `packages/mock-console/server/src/validation.ts` |
| package:mock-console/server/matcher | 无 IO 的 Header / URL / Method 规则计算 | `packages/mock-console/server/src/matcher.ts` `matchApi` |
| package:mock-console/server/runtime | 按当前 Package、优先级和 active scenario 生成扩展 Mock 判定；不执行真实请求 | `packages/mock-console/server/src/runtime-resolver.ts` `resolveExtensionRequest` |
| package:mock-console/server/proxy | 当前 Package 匹配、Mock 返回和未命中流式转发；保持 Reqable / 代理语义 | `packages/mock-console/server/src/proxy.ts` `createProxy` |
| package:mock-console/server/logs | 代理请求结果、匹配接口和响应预览的运行态内存记录 | `packages/mock-console/server/src/request-logs.ts` `packages/mock-console/server/src/proxy.ts` |
| package:mock-console/shared | 前后端与扩展共用的 Mock 配置、运行日志和扩展判定 DTO | `packages/mock-console/shared/types.ts` |
| package:mock-console/web | Vue 3 管理页面、管理请求、配置状态、动作和视图组件 | `packages/mock-console/web/src/` |
| package:chrome-extension/main | MAIN world 包装页面 fetch 与异步 XHR；命中时构造 JSON 响应，未命中调用原生 API | `packages/chrome-extension/src/content-main.ts` |
| package:chrome-extension/bridge | 隔离世界消息桥，转发页面与扩展 Service Worker 的判定消息 | `packages/chrome-extension/src/content-bridge.ts` |
| package:chrome-extension/worker | 校验请求域名白名单、通过扩展 host permission 请求本机 resolver；失败时返回放行决定，并维护 Popup 的开关和连接状态 | `packages/chrome-extension/src/service-worker.ts` `packages/chrome-extension/src/domain-whitelist.ts` |
| package:chrome-extension/popup | 展示连接状态，配置请求域名白名单，切换全局 Mock 或当前标签页 Mock；不读取或保存 Mock 规则 | `packages/chrome-extension/src/popup.ts` `packages/chrome-extension/public/popup.html` |

## 运行与数据

- `npm run dev` 同时启动 Mock Console 服务（22333）与管理页面（22334）；`npm run build` 同时构建 `packages/mock-console/dist` 和 `packages/chrome-extension/dist`；`npm start` 运行 Mock Console。服务端终端默认只保留启动、错误和安全拒绝信息，逐条 Proxy 匹配结果通过控制台日志面板查看。
- Mock Console 正式页面、管理 API、Reqable Mock / Proxy 仍由 `http://127.0.0.1:22333` 提供。配置文件默认保存在当前用户数据目录，仓库只保留脱敏示例。
- Chrome 扩展默认只连接 `http://127.0.0.1:22333/__mock_extension/resolve`。判定接口只允许 loopback，命中返回一次性 `{ action: "mock", status, delayMs, body, headers }`，未命中返回 `{ action: "pass" }`，不会使用 `targetBaseUrl` 代理真实请求。
- 扩展不保存 Package、Logical API、Match Rule 或 Scenario；场景和规则仍由 Mock Console 单一拥有。请求域名白名单保存在 `chrome.storage.local`，新安装且未配置时默认包含 `localhost` 和 `127.0.0.1`；Popup 的全局/当前标签页开关只保存在 `chrome.storage.session`。扩展模式的真实请求由页面原生 fetch / XHR 发出，因此现有 Proxy 日志不会自动获得真实放行请求的最终响应信息。
- 扩展当前覆盖请求目标域名命中白名单的 `fetch` 和异步 `XMLHttpRequest`，不覆盖非白名单请求、导航、资源加载、WebSocket、Worker / Service Worker 请求、同步 XHR、流式或二进制 Mock。扩展只能传递页面脚本可观察到的请求 Header。
- 管理 API 与扩展 resolver 都受本机访问边界保护；扩展通过 Service Worker 访问本机，页面不直接访问管理 API。Mock Console 页面自身的 22333/22334 页面不会注入扩展拦截器。
