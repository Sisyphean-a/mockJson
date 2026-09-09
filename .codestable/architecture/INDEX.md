# 架构索引

## 范围地图

- **workspace**：`mockJson`，Node.js 单仓库、npm workspaces。
- **package:mock-console**：`packages/mock-console/`，本地 Mock / Proxy 控制台，负责配置、匹配、resolver、Proxy、日志和 Vue 管理页面。详见 [`packages/mock-console.md`](./packages/mock-console.md)。
- **package:chrome-extension**：`packages/chrome-extension/`，Chrome Manifest V3 扩展，负责页面请求桥接、白名单、开关和原生放行。详见 [`packages/chrome-extension.md`](./packages/chrome-extension.md)。
- **package:extension-contract**：`packages/extension-contract/`，只提供扩展与本机 resolver 之间的 TypeScript 线协议类型。详见 [`packages/extension-contract.md`](./packages/extension-contract.md)。
- **shared:extension-runtime**：两个产品包共同遵守的 resolver 调用、Mock / pass 和放行语义。详见 [`shared/extension-runtime.md`](./shared/extension-runtime.md)。

## 包边界与依赖方向

```text
package:chrome-extension ─┐
                          ├─> package:extension-contract
package:mock-console ─────┘
```

- `package:mock-console` 拥有 Mock Package、Logical API、Match Rule、Scenario、resolver、Proxy 和运行日志。
- `package:chrome-extension` 不保存或复制 Mock 配置，不导入 `package:mock-console` 的内部源码。
- `package:extension-contract` 不依赖浏览器、Fastify 或任一产品包；产品包之间不得通过内部相对路径共享类型。
- `requirements/CONTEXT.md` 维护领域规则；本目录只维护边界、入口、依赖和跨包机制，不复制完整业务规则。

## 主要入口

| 范围 | 入口 | 责任 |
| --- | --- | --- |
| mock-console server | `packages/mock-console/server/src/index.ts` | Fastify 组合根、服务端口和运行边界 |
| mock-console resolver | `packages/mock-console/server/src/extension-routes.ts`、`runtime-resolver.ts` | 扩展判定 HTTP 转换与 Mock / pass 结果 |
| mock-console web | `packages/mock-console/web/src/` | Vue 管理页面和管理 API 客户端 |
| chrome-extension main | `packages/chrome-extension/src/content-main.ts` | MAIN world fetch / 异步 XHR 桥接 |
| chrome-extension bridge | `packages/chrome-extension/src/content-bridge.ts` | 隔离世界消息桥 |
| chrome-extension worker | `packages/chrome-extension/src/service-worker.ts` | 白名单、resolver、开关和健康状态 |
| chrome-extension popup | `packages/chrome-extension/src/popup.ts` | Popup 配置和连接状态 |
| extension-contract | `packages/extension-contract/src/index.ts` | 跨包 DTO 和放行原因类型 |

## 运行入口

- `npm run dev`：启动 Mock Console 服务（22333）和管理页面（22334）。
- `npm run build`：构建 Mock Console 与 Chrome 扩展；扩展产物位于 `packages/chrome-extension/dist`。
- `npm start`：运行正式 Mock Console 服务。
- 扩展默认通过 `http://127.0.0.1:22333/__mock_extension/resolve` 请求本机 resolver；resolver 未命中或失败时由浏览器直接放行真实请求。
