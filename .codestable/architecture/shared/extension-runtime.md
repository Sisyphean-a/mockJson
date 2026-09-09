# shared:extension-runtime

## 作用域

本页记录 `package:mock-console` 与 `package:chrome-extension` 共同遵守的扩展运行时线协议；类型定义唯一位于 [`package:extension-contract`](../packages/extension-contract.md)。

## 调用流

```text
页面 MAIN world
  -> 隔离世界 bridge
  -> Chrome Service Worker
  -> POST /__mock_extension/resolve
  -> Mock Console runtime-resolver
  -> mock 或 pass
```

## 请求与响应

- 扩展发送 `{ url, method, headers }`，只包含页面脚本可观察的请求元数据。
- Mock 响应包含状态码、0–30000ms 延迟、JSON 字符串 body 和响应 Header。
- `pass` 表示扩展不接管真实请求；浏览器随后以原始 URL、Cookie、凭据、CORS 和请求体语义发出真实请求。
- 未命中白名单、resolver 未命中、服务不可用、超时或取消都必须保持真实请求放行。

## 所有者

- `package:extension-contract`：DTO 和放行原因的类型定义。
- `package:mock-console`：loopback resolver HTTP 端点、配置匹配和判定结果。
- `package:chrome-extension`：页面注入、消息桥、白名单、生命周期和原生请求放行。
