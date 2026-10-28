# shared:extension-runtime

## 作用域

本页记录 `package:mock-console` 与 `package:chrome-extension` 共同遵守的扩展运行时及主动响应交接线协议；类型定义唯一位于 [`package:extension-contract`](../packages/extension-contract.md)。

## 调用流

```text
页面 MAIN world
  -> 隔离世界 bridge
  -> Chrome Service Worker
  -> POST /__mock_extension/resolve
  -> Mock Console runtime-resolver
  -> mock、transform 或 pass
```

## 请求与响应

- 扩展发送 `{ url, method, headers, body?, bodyUnavailable? }`；`body` 是页面可读取的文本请求体原文，供判定日志及 [已匹配接口内部的响应分支](../../requirements/CONTEXT.md#mock-console-领域规则) 使用；`bodyUnavailable` 的 `upload` 表示上传体不采集，`too-large` 表示超出本地 resolver 的 1 MiB 请求容量，`unavailable` 表示读取失败；这些状态均不携带 `body`，仍可使用请求元数据，具体条件语义见上述规则。bridge、Service Worker 和 resolver 都校验此状态，日志请求体的 `unavailableReason` 保留该标记供 UI 展示；支持范围见 [上传判定规则](../../requirements/CONTEXT.md#chrome-extension-领域规则)。
- `mock` 响应包含状态码、0–30000ms 延迟、JSON 字符串 body 和响应 Header。
- `transform` 响应包含 `responseType`（`real-overrides` / `mock-with-real`）、`fieldPaths`、状态码、延迟及场景 JSON 字符串 `body`；不携带真实响应。bridge、worker、MAIN world 均校验新分支。浏览器发出一次原生请求后，在 MAIN world 使用契约包的纯 JSON 函数组合并记录最终观测；真实响应不回传 resolver。服务端判定日志记录场景但状态为 0、无最终响应体。执行和失败语义唯一见[混合响应执行](../../requirements/CONTEXT.md#mock-console-领域规则)。
- `pass` 表示扩展不接管真实请求；浏览器随后以原始 URL、Cookie、凭据、CORS 和请求体语义发出真实请求。
- 页面授权未通过（见 [Chrome Extension 领域规则](../../requirements/CONTEXT.md#chrome-extension-领域规则)）、resolver 未命中、服务不可用、超时或取消都必须保持真实请求放行；用于条件判定和日志的请求体副本不得消耗原始 Request，也不得为未进入 resolver 的请求增加日志。
- 请求观测面板（traffic）是扩展内部能力，使用 `packages/chrome-extension/src/protocol.ts` 的内部消息和本地缓冲，不经过 resolver，也不改变本页描述的线协议；面板可在 resolver 离线时记录放行的真实响应。

## 主动响应交接

此通道独立于 resolver 和本地观测缓冲，只有用户主动点击时调用，不改变运行时判定协议。

- 扩展 `capture-handoff.ts` 校验响应已完成、未截断、可采集且为合法 JSON，再发送 `ExtensionCaptureInput`（仅 URL、Method、响应状态码和文本内容）至 `POST /__mock_extension/captures`；不发送请求 Header、Cookie 或请求体。
- 服务端 `capture-routes.ts` 复核 http(s) URL、Method、200–599 状态码、合法 JSON 和既有观测的 64K 字符文本上限（XHR 多字节完整文本不按字节再次裁剪），返回 `ExtensionCaptureTicket`；扩展打开 `/#capture=<id>`，URL 不携带响应原文。
- 草稿只在服务内存驻留，15 分钟后不可读取、每分钟清理过期原文，关闭服务时清空，不写配置或请求日志。期限用于减少响应原文留存；服务重启或草稿过期后须从扩展重新交接。
- 控制台通过 `GET /__mock_admin/captures/:id` 读取，通过 `POST /__mock_admin/captures/:id/save` 确认；同一草稿的并发保存与成功后重试返回同一结果，保存失败保留可重试草稿。保存业务语义唯一见[扩展响应转场景规则](../../requirements/CONTEXT.md#mock-console-领域规则)。
- 交接和确认接口均限制 loopback，显式拒绝非本机网页 Origin；允许 Chrome 扩展和本机控制台来源，POST 必须为 application/json，响应 no-store。捕获数据与配置仍由 Mock Console 拥有，扩展不读写配置副本。

## 所有者

- `package:extension-contract`：DTO、响应类型和放行原因的类型定义，以及无 IO 的 JSON 字段组合与校验。
- `package:mock-console`：loopback resolver HTTP 端点、配置匹配和判定结果。
- `package:chrome-extension`：页面注入、消息桥、白名单、生命周期和原生请求放行。
