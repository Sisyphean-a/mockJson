# package:extension-contract

## 职责

`packages/extension-contract/` 是扩展与本机 resolver 之间的共享线协议包。它只提供 TypeScript 类型，不包含浏览器 API、Fastify、Mock 配置、持久化或运行时副作用。

## 拥有的契约

- `ExtensionRuntimeRequest`：绝对 URL、HTTP Method 和页面脚本可观察的请求 Header。
- `ExtensionRuntimeResponse`：`mock` 判定（状态码、延迟、JSON body、响应 Header）或 `pass` 判定。
- `ExtensionPassReason`：未命中、停用、无效请求和不支持状态等放行原因。

源码入口：`packages/extension-contract/src/index.ts`。

## 依赖方向

```text
package:chrome-extension ─┐
                          ├─> package:extension-contract
package:mock-console ─────┘
```

该包不能反向依赖任一产品包。产品包之间不能通过对方的内部相对路径共享类型。

## 变化规则

这是跨包协议边界。修改字段、联合分支或放行原因时，必须同时验证扩展发送方、Service Worker、resolver 路由和运行时判定；普通 Mock 配置变化不应修改本包。
