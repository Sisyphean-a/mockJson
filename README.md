# Mock Console

本地 Mock / Proxy 控制台：用逻辑接口、匹配条件和完整响应场景，快速切换 Android 测试请求的返回结果。

## 启动

```bash
npm install
npm run dev
```

管理页面（开发模式）默认在 `http://127.0.0.1:22334`，Mock / Proxy 服务监听 `0.0.0.0:22333`。配置保存在 `data/mock-data.json`，写入采用临时文件替换并保留 `.bak`。

正式使用时执行：

```bash
npm run build
npm start
```

此时页面、管理 API 和 Mock 请求统一使用 `http://127.0.0.1:22333`。Package 的 `targetBaseUrl` 是未命中时要转发的真实后端地址，不默认占用本地 Mock 端口，需要按测试环境填写。

## 使用方式

1. 启动服务并打开 `http://127.0.0.1:22333`。
2. 在顶部「真实服务」输入真实测试环境地址，例如 `https://api.example.com`，点击「保存」。这是未命中 Mock 或关闭 Mock 时的转发目标。
3. 创建逻辑接口，添加 `Header.apiName` 或 `URL.path` 匹配条件。
4. 创建场景并保存完整 JSON，点击场景卡片切换「当前使用」场景。
5. Reqable 将需要 Mock 的请求重写到 `http://电脑局域网IP:22333/原始路径`，保留查询参数和业务 Header。

如果请求没有命中接口：

- 已配置 `targetBaseUrl`：Mock Console 向真实服务转发并返回真实响应。
- 未配置 `targetBaseUrl`：返回错误，因为原始响应仍在真实服务或 Reqable 中，本项目无法直接获得它。
- 只希望 Reqable 自己处理未命中请求：不要把这些请求重写到 `22333`。

HTTPS 请求由 Reqable 负责解密和重写；本项目不提供 HTTPS MITM。Android 连接电脑时使用电脑局域网 IP，不要使用 Android 自己的 `127.0.0.1`。

- 空白初始 Package，不携带参考项目的 mock 数据
- Package / Logical API / Scenario 管理 API
- Header（大小写不敏感）与 URL 的 equals / contains 等匹配
- 优先级命中、场景即时切换、JSON 校验、延迟（上限 30 秒）
- 未命中或关闭 Mock 时透明转发到 Package 的 `targetBaseUrl`
- Vue 3 + TypeScript 页面，场景区和 JSON 编辑器为主要操作区域

Reqable 等客户端只需将请求转发至 `22333`；本项目不做 HTTPS MITM 或请求体重编码。
