# package:chrome-extension

## 职责

`packages/chrome-extension/` 是 Chrome Manifest V3 浏览器扩展产品包，负责把页面脚本可观察的 `fetch` / 异步 `XMLHttpRequest` 请求送到本机 resolver 判定，并在命中时构造 JSON 响应；它不拥有 Mock 配置。

## 边界

- `content-main.ts` 运行在 MAIN world，包装页面请求；白名单未命中时保持原始请求放行，上传、流式和二进制请求不进入 JSON resolver。
- `content-bridge.ts` 运行在隔离世界，只负责页面与 Service Worker 的消息桥接和取消传播。
- `service-worker.ts` 负责白名单、启用状态、本机 resolver 请求、超时、并发和健康短路。
- `popup.ts` 只负责扩展开关、白名单和本机服务状态，不读取 Mock Package、Logical API 或 Scenario。
- 不直接导入 `package:mock-console` 的源码；跨包 resolver DTO 只通过 [`package:extension-contract`](./extension-contract.md) 引用。

## 内部入口

| 区域 | 入口 | 责任 |
| --- | --- | --- |
| main | `packages/chrome-extension/src/content-main.ts` | MAIN world 请求拦截、原生放行和 Mock 响应 |
| bridge | `packages/chrome-extension/src/content-bridge.ts` | 隔离世界消息转发和取消 |
| worker | `packages/chrome-extension/src/service-worker.ts` | 白名单、resolver、开关和健康状态 |
| popup | `packages/chrome-extension/src/popup.ts` | Popup 交互与扩展运行态配置 |
| public | `packages/chrome-extension/public/manifest.json` | MV3 注入、权限和 Popup 声明 |

## 依赖

- 依赖 [`package:extension-contract`](./extension-contract.md) 的类型契约。
- 运行时只访问本机 `http://127.0.0.1:22333/__mock_extension/*`，不访问 Mock Console 的内部模块。
- 不保存或复制 Mock 配置；配置和匹配规则的唯一来源仍是 `package:mock-console`。

## 外部契约

- 请求目标域名必须命中 Popup 白名单才会进入 resolver 判定。
- resolver 返回 `pass`、服务不可用、超时或取消时，页面继续使用浏览器原生请求。
- 命中场景时只支持 JSON、200–599 状态码和异步请求；导航、资源、WebSocket、Worker / Service Worker、同步 XHR、流式和二进制 Mock 不由扩展接管。
