# Tapline

[English](README.md) | 简体中文

不离开 VS Code 即可捕获并检查 HTTP、HTTPS、HTTP/2、HTTP/3、gRPC、WebSocket 和 SSE
流量。集成终端和调试会话经由本地代理转发，代理用自己的根 CA 解密 TLS；系统其他部分
不受影响。

从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
或 [Open VSX](https://open-vsx.org/extension/fqix/tapline) 安装。

## 功能

- **Charles 风格视图** — 侧边栏是 _结构_ 树（主机 → 路径 → 请求），编辑区只有一个流量
  面板：可排序、可过滤的 _序列_ 表格（状态码 / 方法快捷筛选、按主机查看、多选），详情可
  放在下方或右侧。详情包含带时序瀑布图的概览、请求与响应页（Headers、Query、Cookies、
  Form 与 multipart 字段、JWT 解码、Trailers，正文支持格式化 JSON / XML / 文本 /
  十六进制 / 图片预览，并可在正文中查找），WebSocket 帧和 SSE 事件实时刷新。压缩的正文
  （gzip、deflate、br、zstd）会自动解码。
- **规则** — 断点（暂停请求或响应以便编辑）、改写（方法、URL、状态码、头、正文）、
  映射到本地（用文件或内联内容响应）、映射到远程（发到另一个源）、拦截和限速。在面板中
  编辑，保存在 `tapline.rules`（见下文）。
- **发送请求** — 从零编写请求，或对抓到的请求 _编辑并重发_；响应像其他请求一样出现在
  列表中。
- **过滤语法** — `status:5xx method:post host:api.* path:/v1 type:json proto:grpc
size>10k dur>500 body:"not found" header:x-id=1 -status:2xx`；普通词匹配 URL、方法或
  状态码。_统计_ 按主机汇总当前过滤出的请求，并列出最慢和最大的响应。
- **gRPC 解码** — 从 length-prefixed 的 body 中拆出每条消息（支持 gzip/deflate 与 gRPC-Web），
  用工作区的 `.proto`（`tapline.grpc.protoFiles`）解出字段名，没有 schema 时按字段编号解码；
  `grpc-status` 决定状态颜色，方法列显示为 _gRPC_。
- **流式消息** — WebSocket、SSE 和 gRPC 支持搜索、单条复制、暂停显示与跟随最新；
  暂停或向上滚动时固定当前画面，抓包继续。WebSocket 可按收发方向筛选，并在原连接上
  重发完整的已发送消息（含二进制）；连接关闭或消息被截断时不可重发。SSE 可搜索事件名、
  ID 和内容，gRPC 在流结束前显示已收到的完整消息，仍受正文保留上限约束。
- **自动抓包** — 新终端和调试会话（`node`、`python`、`go`、`java`……可配置）自动获得
  `HTTP(S)_PROXY` 和常见工具的 CA 变量（`SSL_CERT_FILE`、`NODE_EXTRA_CA_CERTS`、
  `REQUESTS_CA_BUNDLE`、`CURL_CA_BUNDLE`、`GIT_SSL_CAINFO`、`JAVA_TOOL_OPTIONS`……）。
- **一键根证书** — 在 macOS、Windows、Linux 的系统证书存储中安装、信任和卸载 CA。
  CA 未被信任时不会开始抓包。
- **复制为 cURL、导出 HAR、重放**，状态栏控制，中英文界面。
- **共享核心** — 所有 VS Code 窗口共用一个抓包代理，最后关闭的窗口负责关停。
- **MCP 服务器** — Copilot Chat、Claude Code、Cursor 等 MCP 客户端可以列出、搜索、读取、
  重放和发送抓到的请求（见下文）。

选中两条请求（Cmd/Ctrl + 点击），使用选择工具栏或右键菜单中的「比较请求」，
即可在 VS Code 原生差异编辑器中对比请求和响应。左侧为较早的记录；对比内容固定为
打开时的快照，Headers 排序、JSON 格式化，二进制正文以 Base64 展示，并标明未完成或截断的抓包。

- **与原请求对比**：在重发记录的右键菜单或详情工具栏中打开与原请求的差异视图。

## 设置

| 设置项                                      | 默认值           | 作用                       |
| ------------------------------------------- | ---------------- | -------------------------- |
| `tapline.port`                              | `3606`           | 抓包代理监听的回环端口     |
| `tapline.autoStart`                         | `false`          | VS Code 启动时自动开始抓包 |
| `tapline.terminal.inject`                   | `true`           | 向新终端注入变量           |
| `tapline.debug.inject` / `debug.types`      | `true` / node, … | 向启动的调试会话注入变量   |
| `tapline.ssl.enabled` / `tapline.ssl.hosts` | `true` / `["*"]` | 解密哪些主机               |
| `tapline.maxEntries` / `tapline.maxBodyKiB` | `2000` / `512`   | 保留的事务数与正文字节数   |
| `tapline.mcp.enabled` / `tapline.mcp.port`  | `true` / `3607`  | 供 AI 助手使用的 MCP 端点  |
| `tapline.grpc.protoFiles`                   | `["**/*.proto"]` | 解码 gRPC 消息用的 schema  |
| `tapline.rules`                             | `[]`             | 拦截规则（见下文）         |

## 规则

规则按顺序应用于 URL 匹配其通配模式（`*` 匹配任意内容；不含 `*` 时按前缀匹配；留空匹配
全部）且方法匹配（可选）的每个请求。点击流量面板中的尺子按钮或 _Tapline: 规则…_ 打开
编辑器；请求右键菜单中的 _在此 URL 上设置断点_ 会直接为它添加断点。规则就是普通设置，
也可以手写：

```jsonc
"tapline.rules": [
    { "kind": "breakpoint", "url": "https://api.example.com/v1/orders*", "request": true, "response": true },
    { "kind": "rewrite", "url": "*/v1/*", "request": { "headers": { "X-Debug": "1", "Authorization": null } },
      "response": { "status": 500, "bodyReplace": { "pattern": "\"ok\":true", "replacement": "\"ok\":false" } } },
    { "kind": "mapLocal", "url": "*/users.json", "file": "mocks/users.json" },
    { "kind": "mapLocal", "url": "*/feature-flags", "body": "{\"beta\": true}", "status": 200 },
    { "kind": "mapRemote", "url": "https://api.example.com/*", "to": "http://localhost:8080" },
    { "kind": "block", "url": "*://telemetry.*", "status": 403 },
    { "kind": "throttle", "url": "*", "latencyMs": 800, "kbps": 256 }
]
```

| 类型         | 效果                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `breakpoint` | 暂停请求和/或响应；详情面板显示编辑器，带 _继续_ 和 _中止_。                                      |
| `rewrite`    | `method`、`url`（正则 → 替换）、`status`、`headers`（`null` 表示删除）、`body` 或 `bodyReplace`。 |
| `mapLocal`   | 用 `file`（相对工作区或绝对路径）或 `body` 响应；`contentType` 留空时自动推断。                   |
| `mapRemote`  | 把请求发到 `to`（源，可带路径前缀），保留路径和查询串；`Host` 头随之更新。                        |
| `block`      | 不访问服务器，直接以 `status`（默认 403）拒绝。                                                   |
| `throttle`   | 转发前延迟 `latencyMs`，两个方向的正文都按 `kbps` 限速。                                          |

改写或编辑过的正文以未压缩形式发送并移除 `Content-Encoding`；`text/event-stream` 响应
不会被缓冲，只能改状态码和头。被规则处理过的请求在列表中显示铅笔图标，概览里列出规则名；
`rule:any` 可以筛出它们。

## 根证书

CA 位于插件的全局存储目录（`Tapline: 复制根证书路径`）。开启 `tapline.ssl.enabled`
时，只有系统信任了 CA 才会开始抓包；侧边栏和状态栏会提示安装，`Tapline: 卸载根证书`
可将其移除。

| 平台    | 证书存储                                              |
| ------- | ----------------------------------------------------- |
| macOS   | 登录钥匙串，通过 `security`（系统密码对话框）         |
| Windows | 当前用户受信任的根证书，通过 `certutil`（确认对话框） |
| Linux   | 发行版锚点目录 + 更新命令，在终端中以 `sudo` 执行     |

Firefox 和 snap/flatpak 浏览器使用自己的证书存储，需要手动导入。将
`tapline.ssl.enabled` 设为 `false` 可在不解密、不安装证书的情况下抓包。

## MCP 服务器

抓包代理内置一个 [MCP](https://modelcontextprotocol.io) 端点 `http://127.0.0.1:3607/mcp`
（Streamable HTTP，端口和开关见 `tapline.mcp.*`），让 AI 助手直接基于真实流量工作：
`status`、`list_requests`、`search`、`get_request`、`get_body`、`replay`、`send`、
`export_har`，以及 `start_capture` / `stop_capture` / `set_recording` / `clear` / `delete`
和 `tapline://requests/{id}` 资源。

运行 _Tapline: 配置 MCP 服务器…_（流量视图的 `…` 菜单里也有）可一键安装到 Cursor、复制
URL、复制 `mcp.json` 用的 JSON 片段或 `claude mcp add` 命令。只要有任一窗口加载了
Tapline，端点就在线——不需要额外进程，也不依赖 PATH 中的 `node`；和代理一样只监听本地
回环地址。

## 工作原理

Node agent 驱动随插件打包的、打了补丁的 [sing-box](third_party/patches/sing-box/README.md)：
sing-box 用 Tapline CA 签发的叶证书终止 TLS，把正文流式传给 agent，后者记录后原样
转发。

## 开发

需要 Node 22+、Go 1.27+ 和 git。

```sh
git clone --recurse-submodules https://github.com/fqix/tapline.git && cd tapline
npm ci
npm run core:build     # 打补丁并构建 sing-box 到 core/<platform>-<arch>/
npm run build          # esbuild → dist/
npm test               # vitest：单元测试 + 针对核心的集成测试
npm run test:e2e       # 在真实 VS Code 中运行插件（首次运行会下载 VS Code）
npm run package        # 当前平台的 VSIX（package:all 构建全部六个）
```

按 F5 启动扩展开发宿主。CI 在每次 push 时构建、测试并打包所有平台。

## 发版

CI 从不发布。升级版本号、推送 tag，然后在 GitHub 上发布 release：

```sh
npm version patch && git push --follow-tags
```

[release 工作流](.github/workflows/release.yml)会重新构建所有平台，发布到 VS Code
Marketplace（通过 OIDC 以 Azure 托管标识登录，不用 PAT）和 Open VSX，并把 VSIX 附加到
release 上。

## 许可证

MIT。随插件打包的 sing-box 核心为 GPL-3.0，其源码修订、补丁和声明随每个二进制一起发布。
