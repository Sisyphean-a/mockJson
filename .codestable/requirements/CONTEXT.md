# 领域上下文索引

## 领域地图

本工作区拥有一个 Mock 控制台上下文，规则依据当前实现与用户后续确认的产品主线。

## 产品主线

本项目是面向多种使用场景的本地 Mock / Proxy 工具，不限定使用者身份或客户端类型。核心价值是：将请求匹配到用户理解的逻辑接口，并在该接口的多个完整响应场景之间快速切换，从而验证或演示不同业务状态。

核心场景：用户收到一个需要改变返回结果的请求，配置接口匹配条件和多份完整 JSON 响应，切换当前场景后再次发起请求即可得到对应响应。

体验不变量：接口之间必须可靠隔离；场景切换必须直接且明确；每个场景保存完整响应；未命中时明确转发真实服务或报告配置错误。

反目标：不把产品中心扩展为通用抓包分析器、统计 Dashboard、HTTPS MITM、云同步或协作平台。


- **Package（测试包）**：当前被测试的 APK / 产品版本；同一时间只有一个 `currentPackageId`，并拥有独立的真实服务地址和 Logical API 集合。
- **Logical API（逻辑接口）**：用户按业务理解的接口，不以 `apiName` 作为名称或主键；按 `priority` 从高到低匹配并在首个命中后停止。
- **Match Rule（匹配规则）**：支持任意 Header、URL（fullUrl / host / path）与 HTTP Method，接口内按 AND 或 OR 组合；Header 名称比较不区分大小写；零条规则表示不匹配任何请求，不作为全量兜底。
- **Scenario（响应场景）**：保存完整且合法的 JSON、HTTP 状态码和 0–30000ms 延迟；新建场景默认不启用，选择场景只切换编辑对象，独立开关负责启用、停用或切换当前响应，一个逻辑接口最多启用一个场景。
- Package、Logical API 和 Scenario 都可在控制台完成创建、修改和删除；新建 Logical API 默认关闭，配置场景与规则后再显式开启，未完成接口或没有启用场景的接口不得遮挡其他可用 Mock。
- 接口 `enabled=false`、没有启用场景或没有规则命中时转发当前 Package 的 `targetBaseUrl`；转发保留 JSON 和原始流请求体，保留 `targetBaseUrl` 的基础路径，按目标地址协议选择 HTTP / HTTPS 上游连接，并对无响应上游设置超时。
- Fastify 接收 Reqable 转发的请求 Header，并仅将其用于匹配，不提供请求历史或抓包 Inspector。管理 API 只允许本机访问，局域网客户端仅使用 Mock / Proxy 路径。
- URL 规则中 `path` 仅匹配路径、`host` 匹配收到的 Host、`fullUrl` 包含查询字符串；通过 Reqable 改写目标时优先使用 `path`，因为 Host 可能变成本机地址。
- 配置写入串行化并采用临时文件替换；主文件损坏时仅恢复结构有效的 `.bak`，两者均损坏时明确失败，不静默清空。
- 正式运行时 Fastify 单进程使用 `22333`，同时提供控制台页面、管理 API 和 Mock / Proxy；开发热更新页面使用 `22334`，不使用 `5173`。
- Mock 返回固定使用 `application/json; charset=utf-8`；前后端都拒绝保存非法 JSON。

代表性锚点：`apps/server/src/types.ts`、`apps/server/src/validation.ts`、`apps/server/src/matcher.ts`、`apps/server/src/proxy.ts`、`apps/web/src/useMockConsole.ts`、`apps/web/src/App.vue`。
