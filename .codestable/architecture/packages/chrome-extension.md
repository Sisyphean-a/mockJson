# package:chrome-extension

## 职责

`packages/chrome-extension/` 是 Chrome Manifest V3 浏览器扩展产品包，负责把页面脚本可观察的 `fetch` / 异步 `XMLHttpRequest` 请求送到本机 resolver 判定，并在命中时构造完整 Mock 或真实字段混合的 JSON 响应；同时在扩展本地记录当前标签页的请求观测结果并提供独立面板展示。它不拥有 Mock 配置。

## 边界

- `content-main.ts` 运行在 MAIN world，包装页面请求；页面域名命中白名单且 Mock 启用时进入判定，或用户对当前标签页显式开启“只记录”时进入纯观测模式。未进入任一模式时不安装任何请求 API 包装。multipart / FormData 只发送元数据参与判定，具体支持边界见 [上传判定规则](../../requirements/CONTEXT.md#chrome-extension-领域规则)；不接管流式或二进制 Mock。
- `content-main.ts` 内的 `RequestTraffic` 统一组装 `traffic-start`、`traffic-request-body`、`traffic-finish` 消息、裁剪预览并保证一次结束；请求体补报可晚于结束，发起时间在异步快照前固定。fetch 的唯一 Request / Response.clone()、XHR 原生事件与 generation 各自由原路径负责。该单元留在自包含脚本内，不引入 MAIN world 的运行时共享 chunk。
- `content-bridge.ts` 运行在隔离世界，只负责页面与 Service Worker 的消息桥接、traffic 消息转发和取消传播。
- `service-worker.ts` 负责页面白名单、Mock 与只记录状态、本机 resolver 请求、超时、并发和健康短路；从 Chrome 提供的消息来源 URL 复核 frame 授权，并装配 Chrome 消息、面板端口与会话存储。
- `traffic-store.ts` 的 `TabTrafficStore` 拥有按标签页/frame 合并记录、排序裁剪、会话恢复、防抖串行写回及清空/关闭时的旧读失效。存储与更新通知由 worker 注入，面板端口和开关仍归 worker；容量与采集边界见[请求观测面板规则](../../requirements/CONTEXT.md#chrome-extension-领域规则)。
- `panel.ts` + `public/panel.html` 是同一份面板 UI：既通过 `devtools.ts` 注册为 DevTools 顶部标签，也可作为独立扩展页打开；顶部工具栏只保留筛选、记录、暂停和清空，请求列表按发起时间展示，选中后底部用「请求 / 响应」tab 查看详情。本地观测不依赖 Mock Console；“保存为 Mock 场景”由 `capture-handoff.ts` 主动交接选中响应并打开控制台确认，不直接修改 Mock 配置，见[主动响应交接](../shared/extension-runtime.md#主动响应交接)。
- `popup.ts` 只负责扩展开关、白名单、连接状态、“记录本页请求”和打开请求面板，不读取 Mock Package、Logical API 或 Scenario。
- 不直接导入 `package:mock-console` 的源码；跨包 resolver、响应交接 DTO 和无 IO 的字段组合只通过 [`package:extension-contract`](./extension-contract.md) 引用。traffic 消息和面板 DTO 属于扩展内部 `protocol.ts`，不进入共享契约。

## 内部入口

| 区域 | 入口 | 责任 |
| --- | --- | --- |
| main | `packages/chrome-extension/src/content-main.ts` | MAIN world 请求拦截、原生放行、Mock 响应和 traffic 采集 |
| bridge | `packages/chrome-extension/src/content-bridge.ts` | 隔离世界消息转发、traffic 转发和取消 |
| worker | `packages/chrome-extension/src/service-worker.ts` | 白名单、resolver、开关、Chrome 接线和面板推送 |
| traffic | `packages/chrome-extension/src/traffic-store.ts` | 请求记录生命周期与会话副本 |
| devtools | `packages/chrome-extension/src/devtools.ts`、`public/devtools.html` | 注册 DevTools「接口面板」标签并传入被检查标签页 |
| panel | `packages/chrome-extension/src/panel.ts`、`public/panel.html` | DevTools 面板与独立页共用的请求列表、详情和复制 cURL |
| handoff | `packages/chrome-extension/src/capture-handoff.ts` | 完整 JSON 响应校验与用户主动交接 |
| popup | `packages/chrome-extension/src/popup.ts` | Popup 交互、只记录开关和面板入口 |
| protocol | `packages/chrome-extension/src/protocol.ts` | 扩展内部消息类型、traffic DTO 和校验 |
| public | `packages/chrome-extension/public/manifest.json` | MV3 注入、权限和 Popup 声明 |

## 依赖

- 依赖 [`package:extension-contract`](./extension-contract.md) 的类型契约及 `/response-fields` 纯 JSON 函数；组合实现须被内联进 MAIN world，构建仍核验其自包含性。
- 运行时只访问本机 `http://127.0.0.1:22333/__mock_extension/*`，不访问 Mock Console 的内部模块。
- traffic 面板不访问 resolver；Mock Console 离线时仍能记录放行请求。
- 不保存或复制 Mock 配置；配置和匹配规则的唯一来源仍是 `package:mock-console`。

## 外部契约

- 页面授权及 Popup 开关语义以 [Chrome Extension 领域规则](../../requirements/CONTEXT.md#chrome-extension-领域规则) 为唯一依据；MAIN world 和后台都按页面 URL 判定，不按请求目标域名过滤。“只记录”必须由用户按标签页显式开启，开启后只观测、不进入 resolver 判定。
- resolver 返回 `pass`、服务不可用、超时或取消时，页面继续使用浏览器原生请求。
- 命中场景时只支持 JSON、200–599 状态码和异步请求；导航、资源、WebSocket、Worker / Service Worker、同步 XHR、流式和二进制 Mock 不由扩展接管。
- traffic 面板与 DevTools Network 不同：静态资源、导航、Worker / Service Worker、WebSocket、重定向中间跳和扩展未观测的请求不会出现；列表顺序是发起时间，不是调用因果。
- traffic 记录默认只保存在 `chrome.storage.session` 和 Service Worker 内存中，不写入 Mock Console 服务端日志；主动交接只传递选中的响应草稿，不改变观测记录；上传体、二进制、流式和不透明响应不采集内容。
