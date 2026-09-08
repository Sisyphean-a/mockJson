# 领域上下文索引

## 领域地图

本工作区拥有一个 Mock 控制台上下文，并由两个实现包组成：`package:mock-console` 提供配置、匹配和 Mock / Proxy 服务；`package:chrome-extension` 提供浏览器页面请求桥接。npm 包边界不改变领域 Package 的含义。

## 产品主线

本项目是面向多种使用场景的本地 Mock / Proxy 工具，不限定使用者身份或客户端类型。核心价值是：将请求匹配到用户理解的逻辑接口，并在该接口的多个完整响应场景之间快速切换，从而验证或演示不同业务状态。

核心场景：用户收到一个需要改变返回结果的请求，配置接口匹配条件和多份完整 JSON 响应，切换当前场景后再次发起请求即可得到对应响应。

体验不变量：接口之间必须可靠隔离；场景切换必须直接且明确；每个场景保存完整响应；未命中时明确转发真实服务、由浏览器直接放行或报告配置错误。

反目标：不把产品中心扩展为通用抓包分析器、统计 Dashboard、HTTPS MITM、云同步或协作平台；Chrome 扩展也不承诺拦截所有浏览器网络请求。

## Mock Console 领域规则

- **Package（测试包）**：当前被测试的 APK / 产品版本；同一时间只有一个 `currentPackageId`，并拥有独立的真实服务地址和 Logical API 集合。多个浏览器页面和扩展请求共享当前 Package。
- **Logical API（逻辑接口）**：用户按业务理解的接口，不以 `apiName` 作为名称或主键；按 `priority` 从高到低匹配并在首个命中后停止。
- **Match Rule（匹配规则）**：支持任意 Header、URL（fullUrl / host / path）与 HTTP Method，接口内按 AND 或 OR 组合；Header 名称比较不区分大小写；零条规则表示不匹配任何请求，不作为全量兜底。
- **Scenario（响应场景）**：保存完整且合法的 JSON、HTTP 状态码和 0–30000ms 延迟；新建场景默认不启用，选择场景只切换编辑对象，独立开关负责启用、停用或切换当前响应，一个逻辑接口最多启用一个场景。
- Package、Logical API 和 Scenario 都可在控制台完成创建、修改和删除；新建 Logical API 默认关闭，配置场景与规则后再显式开启，未完成接口或没有启用场景的接口不得遮挡其他可用 Mock。
- 接口 `enabled=false`、没有启用场景或没有规则命中时，Reqable / 本地 Proxy 路径转发当前 Package 的 `targetBaseUrl`；转发保留 JSON 和原始流请求体，保留 `targetBaseUrl` 的基础路径，按目标地址协议选择 HTTP / HTTPS 上游连接，并对无响应上游设置超时。
- URL 规则中 `path` 仅匹配路径、`host` 匹配收到的 Host、`fullUrl` 包含查询字符串；通过 Reqable 改写目标时优先使用 `path`，因为 Host 可能变成本机地址。
- Fastify 接收 Reqable 转发的请求 Header，用于匹配并生成本地运行日志；日志只保留最近 200 条 Proxy 请求的匹配结果、接口/场景、状态、耗时和响应体预览，不写入配置文件，也不记录管理/UI 请求。
- 管理 API 只允许本机访问，局域网客户端仅使用 Mock / Proxy 路径；产品不提供通用请求历史或抓包 Inspector。
- 配置写入串行化并采用临时文件替换；主文件损坏时仅恢复结构有效的 `.bak`，两者均损坏时明确失败，不静默清空。

## Chrome Extension 领域规则

- 扩展只保存瞬时的请求判定结果和 Popup 的启用状态，不保存 Package、Logical API、Match Rule 或 Scenario；所有配置和匹配规则仍以 Mock Console 为唯一来源。全局开关和当前标签页开关保存在 `chrome.storage.session`，浏览器重启后默认启用。
- 页面 MAIN world 包装 `fetch` 和异步 `XMLHttpRequest`，通过隔离世界 Content Script 和 Service Worker 请求本机 `POST /__mock_extension/resolve`；页面不直接访问管理 API。
- resolver 接收绝对 `http` / `https` URL、Method 和页面脚本可观察的 Header。命中当前 Package 中启用且有 active scenario 的接口时返回状态码、延迟、JSON body 和 `content-type`；未命中或服务不可用时扩展调用原生浏览器 API继续真实请求。
- Popup 提供全局 Mock、当前标签页 Mock 和 Mock Console 连接状态三个可见控制面；全局暂停时 Service Worker 不再请求 resolver，当前标签页暂停时该标签页的请求直接放行。
- 扩展模式不使用 `targetBaseUrl`，因为未命中请求必须由浏览器以原始 URL、Cookie、凭据和 CORS 语义直接发出；当前 Package 仍是全局选择。
- 扩展 resolver 只允许 loopback 访问，不承担真实请求代理，也不记录真实放行请求的最终响应；现有 Reqable / Proxy 路径和其日志语义保持不变。
- 扩展 MVP 支持 JSON、200–599 状态码和异步请求；1xx 场景、同步 XHR、导航/资源加载、Worker / Service Worker 请求、WebSocket、流式或二进制 Mock 不由扩展接管。浏览器自动补充且页面不可观察的 Header 不保证可用于扩展匹配。

## 运行规则

- 正式运行时 Mock Console 服务使用 `22333`，开发热更新页面使用 `22334`；扩展默认连接 `127.0.0.1:22333`，Popup 通过 loopback status 接口显示服务是否在线和是否存在当前 Package。
- npm workspace 目录为 `packages/mock-console` 和 `packages/chrome-extension`。控制台构建产物位于 `packages/mock-console/dist`，扩展构建产物位于 `packages/chrome-extension/dist`。
- 代表性代码锚点：`packages/mock-console/shared/types.ts`、`packages/mock-console/server/src/validation.ts`、`packages/mock-console/server/src/matcher.ts`、`packages/mock-console/server/src/runtime-resolver.ts`、`packages/mock-console/server/src/proxy.ts`、`packages/mock-console/server/src/extension-routes.ts`、`packages/chrome-extension/src/content-main.ts`。
