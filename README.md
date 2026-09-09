# Mock Console

本地 Mock / Proxy 控制台：用逻辑接口、匹配条件和完整响应场景，快速切换不同请求的返回结果。

仓库现在包含两个 npm workspace：

- `packages/mock-console`：Fastify Mock / Proxy 服务、Vue 管理页面和共享领域契约。
- `packages/chrome-extension`：Chrome Manifest V3 扩展，不保存 Mock 配置，只负责页面请求桥接。

## 启动 Mock Console

```bash
npm install
npm run dev
```

管理页面（开发模式）默认在 `http://127.0.0.1:22334`，Mock / Proxy 服务监听 `0.0.0.0:22333`。管理 API 只允许本机访问，局域网设备仍可访问 Mock / Proxy 路径。配置默认保存在当前用户数据目录：Windows 为 `%LOCALAPPDATA%\mock-console\state.json`，macOS 为 `~/Library/Application Support/mock-console/state.json`，Linux 为 `$XDG_DATA_HOME/mock-console/state.json` 或 `~/.local/share/mock-console/state.json`。也可以通过 `MOCK_STATE_FILE` 指定路径。

仓库中的 `data/mock-data.example.json` 只是脱敏示例，不会自动加载。写入采用串行临时文件替换并保留有效 `.bak`；主文件损坏时自动恢复备份，两者都损坏时服务会明确报错。

正式使用时执行：

```bash
npm run build
npm start
```

此时页面、管理 API 和 Mock 请求统一使用 `http://127.0.0.1:22333`。终端默认只输出启动、错误和安全拒绝信息，不再逐条输出请求的 `incoming request` / `request completed`；Proxy 请求的匹配结果请在控制台日志面板查看。Package 的 `targetBaseUrl` 是 Reqable / 本地 Proxy 未命中时要转发的真实后端地址，不默认占用本地 Mock 端口。

## 使用 Mock Console

1. 启动服务并打开 `http://127.0.0.1:22333`。
2. 首次启动为空白状态，点击「+ 包」创建测试包。
3. 在顶部「真实服务」输入真实测试环境地址，例如 `https://api.example.com`，点击「保存」。这是 Reqable / 本地 Proxy 未命中 Mock 或关闭 Mock 时的转发目标。
4. 创建逻辑接口，添加任意 Header、URL.path 或 HTTP Method 匹配条件；已有条件可在操作列直接编辑或删除；新接口默认关闭，配置完成后再开启。
5. 创建场景并设置完整 JSON、状态码和延迟；新场景默认不启用，使用场景旁的开关启用、停用或快速切换当前返回。
6. Reqable 将需要 Mock 的请求重写到 `http://电脑局域网IP:22333/原始路径`，保留查询参数和业务 Header。

如果 Reqable / 本地 Proxy 请求没有命中接口：

- 已配置 `targetBaseUrl`：Mock Console 向真实服务转发并返回真实响应。
- 未配置 `targetBaseUrl`：返回错误，因为原始响应仍在真实服务或 Reqable 中，本项目无法直接获得它。
- 只希望 Reqable 自己处理未命中请求：不要把这些请求重写到 `22333`。

HTTPS 请求由 Reqable 负责解密和重写；本项目不提供 HTTPS MITM。Android 连接电脑时使用电脑局域网 IP，不要使用 Android 自己的 `127.0.0.1`。

## 使用 Chrome 扩展

构建扩展：

```bash
npm run build:extension
```

然后在 Chrome 打开 `chrome://extensions`，开启「开发者模式」，选择「加载已解压的扩展程序」，目录选择：

```text
packages/chrome-extension/dist
```

点击浏览器工具栏中的扩展图标可以打开 Popup：

- **请求域名白名单**：默认是 `localhost` 和 `127.0.0.1`；可按每行一个请求目标域名配置，例如 `api.example.com`，并同时匹配其子域名。留空时所有请求都直接放行，不发送 Mock 判定请求。
- **全局 Mock**：暂停或恢复白名单请求的 Mock。
- **当前标签页**：只暂停或恢复当前标签页发出的白名单请求。
- **连接状态**：显示 Mock Console 是否在线，以及是否已有当前 Package。

白名单保存在扩展的本地配置中；全局开关和当前标签页开关只保存在扩展的临时会话状态中。扩展不会保存 Mock 规则或场景。切换白名单后，已打开的页面会立即刷新拦截状态；切换开关后重新发起请求即可生效，已经发出的请求不会被中途改变。

扩展默认连接本机 `http://127.0.0.1:22333`。只有请求目标域名命中白名单时，页面中的 `fetch` 和异步 `XMLHttpRequest` 才会把 URL、Method 和页面可观察的 Header 交给 Mock Console 判定：

- 命中启用接口和当前场景：返回场景中的 JSON、状态码和延迟。
- 未命中、接口未启用、Mock Console 未启动或 200ms 内未完成判定：调用浏览器原生 API，继续真实请求。

扩展模式不使用 Package 的 `targetBaseUrl`，也不保存接口、规则或场景。当前只覆盖页面脚本的 `fetch` / 异步 XHR，不覆盖导航、图片/脚本资源、WebSocket、Worker / Service Worker 请求、同步 XHR、流式或二进制响应。浏览器自动补充且页面不可观察的 Header（例如 Cookie）不保证可参与扩展匹配。

## 当前能力

- 空白初始状态，不携带参考项目的 Package 或 Mock 数据
- Package / Logical API / Scenario 完整创建、修改和删除
- 任意 Header（名称大小写不敏感）、URL 与 HTTP Method 匹配
- 优先级命中、场景即时切换、JSON/状态码/延迟校验
- Reqable / 本地 Proxy 未命中或关闭 Mock 时透明转发到 `targetBaseUrl`
- Chrome 扩展对页面 `fetch` / 异步 XHR 提供独立的 Mock 判定通道，并通过 Popup 控制全局或当前标签页启停
- Vue 3 + TypeScript 页面，场景区和 JSON 编辑器为主要操作区域

Reqable 等客户端只需将请求转发至 `22333`；本项目不做 HTTPS MITM。
