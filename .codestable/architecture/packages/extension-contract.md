# package:extension-contract

## 职责

`packages/extension-contract/` 是扩展与本机服务之间的 resolver 和主动响应交接共享线协议包。它提供 TypeScript 类型与响应字段组合的纯 JSON 函数，不包含浏览器 API、Fastify、Mock 配置、持久化或运行时副作用。纯组合实现由 Proxy 和 MAIN world 共用，避免字段路径、错误与特殊键规则漂移；这不是通用运行时工具包。

## 拥有的契约

- `ExtensionRuntimeRequest`：绝对 URL、HTTP Method、页面脚本可观察的请求 Header，以及可选的判定/日志用文本请求体或不可采集状态；语义见 [`shared:extension-runtime`](../shared/extension-runtime.md)。
- `ExtensionRuntimeResponse`：`mock` 判定（状态码、延迟、JSON body、响应 Header）、`transform` 判定（响应类型、字段路径、场景 JSON、状态码与延迟）或 `pass` 判定。
- `ExtensionPassReason`：未命中、停用、无效请求和不支持状态等放行原因。
- `ExtensionCaptureInput` / `ExtensionCaptureTicket`：用户主动交接的请求元数据、完整 JSON 响应和临时草稿凭据；语义见[主动响应交接](../shared/extension-runtime.md#主动响应交接)。配置保存 DTO 仍归 Mock Console。

源码入口：`packages/extension-contract/src/index.ts`；`/response-fields` 子路径提供 `ScenarioResponseType`、配置字段校验、`composeResponse` 和组合响应头清理。它只接收 JSON 值，不执行请求或拥有场景选择；业务语义见[响应场景类型](../../requirements/CONTEXT.md#mock-console-领域规则)。MAIN world 使用的函数须内联到其普通脚本，不形成运行时共享 chunk。

## 依赖方向

```text
package:chrome-extension ─┐
                          ├─> package:extension-contract
package:mock-console ─────┘
```

该包不能反向依赖任一产品包。产品包之间不能通过对方的内部相对路径共享类型。

## 变化规则

这是跨包协议边界。修改 resolver 字段、联合分支或放行原因时，必须同时验证扩展发送方、Service Worker、resolver 路由和运行时判定；修改响应交接 DTO 时，验证面板交接、草稿路由和控制台确认入口。普通 Mock 配置变化不应修改本包。
