# package:mock-console

## 职责

`packages/mock-console/` 是本地 Mock / Proxy 控制台的产品包，拥有 Mock 配置、匹配规则、场景、运行时判定、管理 API、Reqable / 本地 Proxy 和 Vue 管理页面。

## 边界

- `server/` 是服务端组合根和运行时边界，负责配置持久化、管理 API、扩展 resolver、Proxy 转发和运行日志；`config-service.ts` 的变更队列统一拥有失败恢复，响应选择保留先持久化候选快照再发布的生效边界。
- `web/` 只负责管理页面、表单、状态和管理 API 客户端，不持有浏览器扩展注入逻辑。
- `shared/response-selection.ts` 拥有响应选择的纯条件判断、校验和引用定位，运行时与草稿试算共用，不执行 IO；业务语义见 [响应选择规则](../../requirements/CONTEXT.md#mock-console-领域规则)。
- `shared/types.ts` 只拥有 Mock Console 的领域状态、配置和日志类型；扩展 resolver 的跨包线协议类型由 [`package:extension-contract`](./extension-contract.md) 拥有。
- 不读取或保存 Chrome 扩展的启用状态、白名单或页面拦截器状态。

## 内部入口

| 区域 | 入口 | 责任 |
| --- | --- | --- |
| server/bootstrap | `packages/mock-console/server/src/index.ts` | Fastify、CORS、静态页面、端口和组合根 |
| server/config | `config-service.ts` | 串行配置变更、失败恢复和持久化协调 |
| server/routes | `admin-routes.ts`、`extension-routes.ts` | 管理 API 与扩展 resolver 的 HTTP 转换 |
| server/capture | `capture-routes.ts`、`config-service.ts` 的 `saveCapturedScenario` | 主动响应草稿、确认保存和原子配置提交；协议见[主动响应交接](../shared/extension-runtime.md#主动响应交接) |
| server/runtime | `runtime-resolver.ts` | 按当前 Package、接口优先级和响应选择生成 Mock / pass 判定 |
| server/proxy | `proxy.ts` | Reqable / 本地 Proxy 请求匹配、Mock 返回和真实转发 |
| server/logs | `request-logs.ts` | 运行态 Proxy / 扩展判定日志 |
| web | `packages/mock-console/web/src/`、`use-capture-import.ts`、`components/CaptureImportPanel.vue` | Vue 管理页面、管理请求和扩展响应确认入口 |

## 依赖

- 依赖 [`package:extension-contract`](./extension-contract.md) 获取扩展 resolver 的线协议类型。
- 不依赖 `package:chrome-extension` 的源码、构建产物或浏览器 API。
- 扩展 resolver 的传输语义见 [`shared/extension-runtime.md`](../shared/extension-runtime.md)。

## 外部契约

- 正式运行入口：`http://127.0.0.1:22333`。
- 管理 API：`/__mock_admin/*`，仅限本机访问。
- 响应选择保存：`PUT /__mock_admin/apis/:id/response-selection`，原子保存当前接口的模式、固定选择、分支与兜底；场景内容仍使用原独立接口。
- 扩展 resolver：`POST /__mock_extension/resolve`，未命中返回 pass，命中返回一次性 JSON Mock 判定。
- Chrome 扩展模式不使用 Package 的 RealService 配置；真实放行请求由浏览器自己发出。
