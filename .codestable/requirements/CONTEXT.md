# 领域上下文索引

## 领域地图

本工作区拥有一个 Mock 控制台上下文，由两个产品包和一个共享契约包组成：`package:mock-console` 提供配置、匹配和 Mock / Proxy 服务；`package:chrome-extension` 提供浏览器页面请求桥接；`package:extension-contract` 只提供扩展与本机 resolver 之间的线协议类型。npm 包边界不改变领域 Package 的含义。

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
- Package、Logical API 和 Scenario 都可在控制台完成创建、修改和删除；Logical API 的 Match Rule 也支持新增、编辑和删除，编辑保留原规则 ID；新建 Logical API 默认关闭，配置场景与规则后再显式开启，未完成接口或没有启用场景的接口不得遮挡其他可用 Mock。
- 控制台的 Logical API 和 Scenario 列表支持通过拖拽手柄长按排序；排序只持久化各自配置数组的 UI 顺序，Logical API 的 `priority` 仍是独立的运行时匹配优先级；Logical API 搜索时禁用排序并提示清除搜索。
- 请求日志是独立的全宽运行观测视图，不显示 Logical API 配置侧栏；日志列表点击只切换详情，详情中的“查看接口配置”才负责切回接口配置并选中对应 Logical API。
- 接口 `enabled=false`、没有启用场景或没有规则命中时，Reqable / 本地 Proxy 路径转发当前 Package 的 `targetBaseUrl`；转发保留 JSON 和原始流请求体，保留 `targetBaseUrl` 的基础路径，按目标地址协议选择 HTTP / HTTPS 上游连接，并对无响应上游设置超时。
- URL 规则中 `path` 仅匹配路径、`host` 匹配收到的 Host、`fullUrl` 包含查询字符串；通过 Reqable 改写目标时优先使用 `path`，因为 Host 可能变成本机地址。
- Fastify 接收 Reqable 转发的请求 Header，用于匹配并生成本地运行日志；日志只保留最近 200 条 Proxy 或 Chrome 扩展判定的匹配结果、接口/场景、来源、状态、耗时和响应体预览，不写入配置文件，也不记录管理/UI 请求。扩展日志是 resolver 判定日志：扩展未命中时记录放行决定，但浏览器随后发出的真实请求响应不经过 Mock Console；白名单过滤、扩展暂停和扩展侧超时不会产生服务端日志。服务端终端默认不逐条输出请求访问日志，只保留启动、错误和安全拒绝信息。
- 管理 API 只允许本机访问，局域网客户端仅使用 Mock / Proxy 路径；产品不提供通用请求历史或抓包 Inspector。
- 配置写入串行化并采用临时文件替换；主文件损坏时仅恢复结构有效的 `.bak`，两者均损坏时明确失败，不静默清空。

## Chrome Extension 领域规则

- 扩展只保存瞬时的请求判定结果、请求域名白名单和 Popup 的启用状态，不保存 Package、Logical API、Match Rule 或 Scenario；所有 Mock 配置和匹配规则仍以 Mock Console 为唯一来源。请求域名白名单保存在 `chrome.storage.local`，新安装且未配置时默认包含 `localhost` 和 `127.0.0.1`；全局开关和当前标签页开关保存在 `chrome.storage.session`。
- 页面 MAIN world 在请求目标域名命中白名单且开关启用时包装 `fetch` 和异步 `XMLHttpRequest`，通过隔离世界 Content Script 和 Service Worker 请求本机 `POST /__mock_extension/resolve`；监控状态通过启动握手同步，非白名单或未启用请求不发送 resolver 请求，页面不直接访问管理 API。
- 对已进入 fetch 判定的请求，MAIN world 先构造唯一的 `Request`；未命中、超时或异常放行时必须复用这个对象调用原生 fetch，不能再用原始 `input/init` 重发，以保持一次性上传体（包括 `ReadableStream`）可用。`multipart`、图片/音视频和 `application/octet-stream` 请求直接由原生 fetch 放行。
- 白名单非空不等于所有页面都可安装 XHR Proxy：只有页面自身 origin 命中白名单时才安装 XHR 拦截器；FormData、Blob、ArrayBuffer、TypedArray 和 ReadableStream 的 XHR 上传直接调用原生 XHR，不进入 resolver。
- MAIN world Content Script 必须构建为自包含的普通脚本，不得保留运行时 `import` 或依赖 Vite 共享 chunk；Chrome Manifest 的 `content_scripts` 直接注入该脚本，模块解析失败会使整个拦截器失效。
- resolver 接收绝对 `http` / `https` URL、Method 和页面脚本可观察的 Header。命中当前 Package 中启用且有 active scenario 的接口时返回状态码、延迟、JSON body 和 `content-type`；Service Worker 的判定等待上限为 1 秒，页面桥接层再保留 200ms 消息往返余量；连续两次 resolver 失败后短路 3 秒，并在当前扩展会话保存健康状态，单个 Service Worker 同时最多处理 32 个 resolver，取消会传播到本机请求并立即放行，未命中、服务不可用或超时扩展调用原生浏览器 API继续真实请求，异常或缺失的桥接结果也必须按放行处理而不能读取未定义的 `action`。
- Popup 提供请求域名白名单、全局 Mock、当前标签页 Mock 和 Mock Console 连接状态；白名单为空或请求目标域名未命中时不发送 resolver 请求，全局/当前标签页暂停时请求直接放行。
- 扩展模式不使用 `targetBaseUrl`，因为未命中请求必须由浏览器以原始 URL、Cookie、凭据和 CORS 语义直接发出；当前 Package 仍是全局选择。
- 扩展 resolver 只允许 loopback 访问，不承担真实请求代理，也不记录真实放行请求的最终响应；现有 Reqable / Proxy 路径和其日志语义保持不变。
- 扩展 MVP 支持白名单请求中的 JSON、200–599 状态码和异步请求；非白名单请求、1xx 场景、同步 XHR、导航/资源加载、Worker / Service Worker 请求、WebSocket、流式或二进制 Mock 不由扩展接管。浏览器自动补充且页面不可观察的 Header 不保证可用于扩展匹配。

## 运行规则

- 正式运行时 Mock Console 服务使用 `22333`，开发热更新页面使用 `22334`；扩展默认连接 `127.0.0.1:22333`，Popup 通过 loopback status 接口显示服务是否在线和是否存在当前 Package。
- npm workspace 目录为 `packages/mock-console`、`packages/chrome-extension` 和 `packages/extension-contract`。控制台构建产物位于 `packages/mock-console/dist`，扩展构建产物位于 `packages/chrome-extension/dist`；共享契约包只提供源码类型，不生成独立运行产物。
- 代表性代码锚点：`packages/extension-contract/src/index.ts`、`packages/mock-console/shared/types.ts`、`packages/mock-console/server/src/validation.ts`、`packages/mock-console/server/src/matcher.ts`、`packages/mock-console/server/src/runtime-resolver.ts`、`packages/mock-console/server/src/proxy.ts`、`packages/mock-console/server/src/extension-routes.ts`、`packages/chrome-extension/src/content-main.ts`。
