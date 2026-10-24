# 领域上下文索引

## 领域地图

本工作区拥有一个 Mock 控制台上下文，由两个产品包和一个共享契约包组成：`package:mock-console` 提供配置、匹配和 Mock / Proxy 服务；`package:chrome-extension` 提供浏览器页面请求桥接；`package:extension-contract` 只提供扩展与本机服务之间的 resolver 和主动响应交接线协议类型。npm 包边界不改变领域 Package 的含义。

## 产品主线

本项目是面向多种使用场景的本地 Mock / Proxy 工具，不限定使用者身份或客户端类型。核心价值是：将请求匹配到用户理解的逻辑接口，并在该接口的多个完整响应场景之间快速切换，从而验证或演示不同业务状态。

核心场景：用户收到一个需要改变返回结果的请求，配置接口匹配条件和多份完整 JSON 响应，切换固定响应场景或配置有序条件分支后再次发起请求，即可得到对应响应。

体验不变量：接口之间必须可靠隔离；场景切换必须直接且明确；每个场景保存完整响应；未命中时明确转发真实服务、由浏览器直接放行或报告配置错误。

反目标：不把产品中心扩展为通用抓包分析器、统计 Dashboard、HTTPS MITM、云同步或协作平台；Chrome 扩展也不承诺拦截所有浏览器网络请求。

## Mock Console 领域规则

- **Package（测试包）**：当前被测试的 APK / 产品版本；同一时间只有一个 `currentPackageId`，并拥有独立的真实服务环境列表、当前选中的 `activeRealServiceId` 和 Logical API 集合。多个浏览器页面和扩展请求共享当前 Package。
- **RealService（真实服务）**：Package 级的环境配置，保存服务名称和基础地址；同一 Package 可配置测试、生产等多个环境，切换当前服务只改变 Reqable / 本地 Proxy 未命中 Mock 时的转发目标，不复制 Package 或 Mock 配置。
- **Logical API（逻辑接口）**：用户按业务理解的接口，不以 `apiName` 作为名称或主键；按 `priority` 从高到低匹配并在首个命中后停止。
- **Match Rule（匹配规则）**：支持任意 Header、URL（fullUrl / host / path）与 HTTP Method，接口内按 AND 或 OR 组合；新建 Logical API 默认使用 OR（满足任一条件），可切换为 AND；Header 名称比较不区分大小写；零条规则表示不匹配任何请求，不作为全量兜底。
- **Scenario（响应场景）**：保存完整且合法的 JSON、HTTP 状态码和 0–30000ms 延迟；接口此前没有场景时，新建的首个场景默认启用，已有场景时新增场景默认不启用；选择场景只切换编辑对象，独立开关负责启用、停用或切换当前响应，固定响应模式下，一个逻辑接口最多启用一个场景；条件分支按引用选择完整场景，查看和编辑不改变响应模式或固定选择。
- **扩展响应转场景**：用户在扩展主动选中完整 JSON 响应后，由控制台确认保存到当前测试包，可新建 Logical API 或追加 Scenario。此入口默认只保存，即使是接口的首个场景也不启用；显式“保存并启用”才启用接口并切换固定响应。条件分支接口只允许追加，须由用户在响应规则中引用，不隐式切换模式。新接口以 AND 联合匹配 Method、Host、Path（忽略查询参数），追加不改已有规则、响应选择和场景；不自动切换当前测试包，不重放真实请求，不改变扩展白名单或开关。接口、规则、场景一次原子提交，失败可重试且同一草稿不重复创建；实现见 `server/src/capture-routes.ts`、`config-service.ts` 的 `saveCapturedScenario`、`web/src/use-capture-import.ts`。草稿传输与生命周期见[主动响应交接](../architecture/shared/extension-runtime.md#主动响应交接)。
- **响应选择（Response Selection）**：每个 Logical API 独立保存固定响应或条件分支模式；旧配置缺省为固定响应。条件分支从上到下判断，首条命中选择目标场景；未命中时，兜底开启返回指定场景，关闭则放行，零分支同样执行未命中动作。已匹配条件分支接口的放行是终局决定，不能继续匹配低优先级接口。接口停用时不执行分支或兜底。
- **分支条件**：只在已匹配接口内部判断请求头和 JSON 请求体，不扩大 Match Rule 的范围。分支内使用 AND / OR，新分支默认 OR，新条件默认 JSON 请求体，既有配置不改写，不嵌套；请求头名称不区分大小写，值为文本；请求体字段使用 JSON Pointer（如 `/user/status`、`/items/0/id`），文本、数字、布尔、null 严格区分。支持等于、不等于、文本包含、存在/不存在和数字大小比较；字段缺失时普通比较均不命中，包括不等于。无效 JSON 或无法读取的请求体使所有请求体条件不命中，不能等同于字段缺失；请求头条件仍可成立。
- **响应选择草稿与保护**：工作区视图与生效模式分开：固定响应/条件分支分段只切换查看，保留两边草稿，不制造未保存状态或弹窗；只有真实配置变化才标记未保存，切换接口等会丢失草稿时才提供保存/放弃/取消。查看非生效模式时，明确点击“启用”或“保存并启用”才改变运行模式；当前生效模式的配置仍通过保存应用。写入中和失败维持原生效配置，场景 JSON 沿用独立保存。关闭兜底保留其选择；所有保留的分支/兜底引用（含非当前模式和关闭状态）都阻止场景删除，须先解除或替换并保存。分支必须有条件和当前接口的目标场景，开启兜底必须有目标。试算与运行时共用条件判断，只计算当前查看模式下的草稿决定，不发送请求，非生效模式的试算也标记为草稿试算；首命中后的分支显示未执行，编辑后旧结果过期。实现锚点：`packages/mock-console/shared/response-selection.ts`、`server/src/config-service.ts` 的 `saveResponseSelection`、`web/src/use-response-selection.ts`。
- Package、Logical API 和 Scenario 都可在控制台完成创建、修改和删除；Logical API 可在测试包之间整体移动（保留接口 ID、优先级、规则及响应场景），不自动切换全局当前测试包，目标测试包必须存在且与来源不同；实现见 `packages/mock-console/server/src/config-service.ts` 的 `moveApi`。Logical API 的 Match Rule 也支持新增、编辑和删除，编辑保留原规则 ID；新建 Logical API 默认启用，未完成接口或固定响应模式下没有启用场景的接口不得遮挡其他可用 Mock。
- 控制台的 Logical API 和 Scenario 列表支持通过拖拽手柄长按排序；排序只持久化各自配置数组的 UI 顺序，Logical API 的 `priority` 仍是独立的运行时匹配优先级；Logical API 搜索时禁用排序并提示清除搜索。
- 请求日志是独立的全宽运行观测视图，不显示 Logical API 配置侧栏；日志列表点击只切换详情，详情中的“查看接口配置”才负责切回接口配置并选中对应 Logical API。
- 接口 `enabled=false`、固定响应没有启用场景、没有规则命中或条件分支决定放行时，Reqable / 本地 Proxy 路径转发当前 Package 选中的 RealService 基础地址；转发保留 JSON 和原始流请求体，保留真实服务的基础路径，按目标地址协议选择 HTTP / HTTPS 上游连接，并对无响应上游设置超时。没有选中的真实服务时明确返回未配置错误。
- URL 规则中 `path` 仅匹配路径、`host` 匹配收到的 Host、`fullUrl` 包含查询字符串；通过 Reqable 改写目标时优先使用 `path`，因为 Host 可能变成本机地址。
- Fastify 接收 Reqable 转发的请求 Header，用于匹配并生成本地运行日志；日志只保留最近 200 条 Proxy 或 Chrome 扩展判定的匹配结果、接口/场景、来源、状态、耗时、请求头、URL 参数、请求体与响应体，不写入配置文件，也不记录管理/UI 请求。按用户明确决定，本地日志保留请求 URL、Header 和可采集请求体的原值，不按字段脱敏；Proxy 文本请求体沿用 32 KB 预览上限，转发原文不变。扩展日志只记录已进入 resolver 判定的请求：页面脚本可观察的 URL、Method、Header 和可读取的文本请求体；超过本地 resolver 容量或无法读取时在日志中明确标识，不阻止请求头条件继续判定。扩展未命中时记录放行决定，但浏览器随后发出的真实请求响应不经过 Mock Console；白名单过滤、扩展暂停和扩展侧超时不会产生服务端日志，不补抓此前放行的请求。浏览器端请求观测面板是扩展本地能力，独立于服务端日志：Mock 判定或用户显式只记录时采集 `fetch` / 异步 XHR 的发起顺序、请求头/文本体、状态码、响应头和文本响应体；放行响应默认只保存在扩展本地，不自动发送到 Mock Console，也不补抓扩展未观测的请求；用户主动执行“扩展响应转场景”时只交接选中的响应。服务端终端默认不逐条输出请求访问日志，只保留启动、错误和安全拒绝信息。
- 管理 API 只允许本机访问，局域网客户端仅使用 Mock / Proxy 路径；产品不提供通用请求历史或抓包 Inspector。
- 配置变更被校验或写入拒绝时，运行态恢复已提交配置，不留下部分修改或污染后续成功保存。配置写入串行化并采用临时文件替换；主文件损坏时仅恢复结构有效的 `.bak`，两者均损坏时明确失败，不静默清空。

## Chrome Extension 领域规则

- 扩展只保存瞬时的请求判定结果、页面域名白名单和 Popup 的启用状态，不保存 Package、Logical API、Match Rule 或 Scenario；所有 Mock 配置和匹配规则仍以 Mock Console 为唯一来源。页面域名白名单保存在 `chrome.storage.local` 的既有 `allowedPageDomains` 键，新安装且未配置时默认包含 `localhost` 和 `127.0.0.1`；已有名单值保留并按页面域名解释，不清空用户配置。域名同时匹配子域名、不区分端口；全局开关和当前标签页开关保存在 `chrome.storage.session`。
- 页面 MAIN world 在自身页面域名命中白名单且 Mock 开关启用时包装 `fetch` 和异步 `XMLHttpRequest` 并发送 resolver 判定；用户还可以对单个标签页显式开启“只记录”，此时同样包装请求 API，但只观测和本地记录，不发送 resolver 请求。两种模式都未开启时，页面（包括非白名单页面）不替换任何请求 API，以免无关页面因函数身份或调用语义变化发生冲突。iframe 按自身页面 URL 独立判断，不继承顶层页面授权；Service Worker 以 Chrome 提供的 `sender.url` 复核页面域名，无来源 URL 时不启用。白名单页面的请求目标域名不参与过滤，可判定跨域 API 请求；通过隔离世界 Content Script 和 Service Worker 请求本机 `POST /__mock_extension/resolve`，监控状态通过启动握手同步，页面不直接访问管理 API。
- 对已进入 fetch 判定的请求，MAIN world 先构造唯一的 `Request`；未命中、超时或异常放行时必须复用这个对象调用原生 fetch，不能再用原始 `input/init` 重发，以保持一次性上传体（包括 `ReadableStream`）可用。图片/音视频和 `application/octet-stream` 请求直接由原生 fetch 放行；`multipart` 请求按下面的上传判定规则处理。
- **上传判定**：白名单页面的 fetch `multipart` 请求及异步 XHR 的 FormData / `multipart` 请求，仅以 URL、Method 和页面可见 Header 进入既有 resolver，不读取、解析、复制或传输文件内容，不按文件内容匹配，也不新增开关。XHR 在 `send` 时仅快照 FormData 的字段、顺序和 File 引用，避免页面在等待判定期间修改原表单影响真实上传。命中时返回现有场景 JSON，不发生真实上传；未命中或判定失败时由原生 API 使用发送时的请求体继续上传。日志明确显示“上传请求体未采集”。只 Mock 返回，不模拟 `xhr.upload` 的进度和完成事件；XHR 自动生成的 multipart Header 不补造。场景中的文件地址如需供页面预览，仍须真实可访问。Blob、ArrayBuffer、TypedArray 和 ReadableStream 的独立 XHR 请求体仍直接调用原生 XHR，不进入 resolver。
- MAIN world Content Script 必须构建为自包含的普通脚本，不得保留运行时 `import` 或依赖 Vite 共享 chunk；Chrome Manifest 的 `content_scripts` 直接注入该脚本，模块解析失败会使整个拦截器失效。
- resolver 接收绝对 `http` / `https` URL、Method 和页面脚本可观察的 Header。命中当前 Package 中启用且响应选择决定返回场景的接口时返回状态码、延迟、JSON body 和 `content-type`；Service Worker 的判定等待上限为 1 秒，页面桥接层再保留 200ms 消息往返余量；连续两次 resolver 失败后短路 3 秒，并在当前扩展会话保存健康状态，单个 Service Worker 同时最多处理 32 个 resolver，取消会传播到本机请求并立即放行，未命中、服务不可用或超时扩展调用原生浏览器 API继续真实请求，异常或缺失的桥接结果也必须按放行处理而不能读取未定义的 `action`。
- Popup 提供页面域名白名单、全局 Mock、当前标签页 Mock、Mock Console 连接状态、“记录本页请求”和打开请求面板的入口；当前页面不命中时显示“不在页面白名单”并禁用标签页 Mock 开关，该开关不能绕过页面授权，但“记录本页请求”仍可对受支持的 http(s) 页面显式开启。白名单为空或全局/当前标签页暂停时恢复原生请求 API，已保存的包装也不再发起 Mock 判定；只记录开启时请求 API 保持观测包装但不进入判定。
- 扩展模式不使用 Package 的 RealService 配置，因为未命中请求必须由浏览器以原始 URL、Cookie、凭据和 CORS 语义直接发出；当前 Package 仍是全局选择。
- 扩展 resolver 只允许 loopback 访问，不承担真实请求代理；扩展 resolver 和 Mock Console 服务端日志都不记录真实放行请求的最终响应，放行响应默认由扩展本地请求观测面板保存在浏览器会话中；主动交接响应转场景不经过 resolver 或请求日志。现有 Reqable / Proxy 路径和其日志语义保持不变。
- **请求观测面板**：面板注册为 DevTools 顶部标签，也可作为独立扩展页打开；两者按标签页展示 `fetch` / 异步 XHR 的请求详情和发起顺序，不依赖后端，Mock Console 离线时仍可记录放行请求。记录来源是 Mock 判定或用户显式开启的“只记录”；顺序按发起时间而非推断调用因果。单条请求体/响应体预览上限 64 KiB，上传体、二进制、流式（`text/event-stream`）和不透明响应不采集内容（二进制请求仍保留 URL、方法、状态和响应头）；每标签页内存保留最近 500 条，`chrome.storage.session` 保留最近 200 条且单字段预览 4 KiB。静态资源、导航、Worker / Service Worker、WebSocket 和重定向中间跳不出现在面板中，面板不承诺替代 DevTools Network。
- 扩展 MVP 支持白名单页面请求中的 JSON、200–599 状态码和异步请求；非白名单页面、1xx 场景、同步 XHR、导航/资源加载、Worker / Service Worker 请求、WebSocket、流式或二进制 Mock 不由扩展接管。浏览器自动补充且页面不可观察的 Header 不保证可用于扩展匹配。

## 运行规则

- 正式运行时 Mock Console 服务使用 `22333`，开发热更新页面使用 `22334`；扩展默认连接 `127.0.0.1:22333`，Popup 通过 loopback status 接口显示服务是否在线和是否存在当前 Package。
- npm workspace 目录为 `packages/mock-console`、`packages/chrome-extension` 和 `packages/extension-contract`。控制台构建产物位于 `packages/mock-console/dist`，扩展构建产物位于 `packages/chrome-extension/dist`；共享契约包只提供源码类型，不生成独立运行产物。
- 代表性代码锚点：`packages/extension-contract/src/index.ts`、`packages/mock-console/shared/types.ts`、`packages/mock-console/server/src/validation.ts`、`packages/mock-console/server/src/matcher.ts`、`packages/mock-console/server/src/runtime-resolver.ts`、`packages/mock-console/server/src/proxy.ts`、`packages/mock-console/server/src/extension-routes.ts`、`packages/chrome-extension/src/content-main.ts`。
