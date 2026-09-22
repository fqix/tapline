# Tapline

[English](README.md) | 简体中文

[![VS Code Marketplace installs](https://vsmarketplacebadges.dev/installs-short/fqix.tapline.svg?label=VS%20Code%20Marketplace%20installs)](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/fqix/tapline?label=Open%20VSX%20downloads)](https://open-vsx.org/extension/fqix/tapline)

不离开 VS Code 即可捕获、检查、改写和重放 HTTP、HTTPS、HTTP/2、HTTP/3、gRPC、WebSocket
和 SSE 流量。集成终端和调试会话经由本地代理转发，代理用自己的根 CA 解密 TLS；系统其他
部分不受影响。

从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
或 [Open VSX](https://open-vsx.org/extension/fqix/tapline) 安装。

![Tapline：证书安装、HTTP 抓包、重发、Diff 与 gRPC 字段解析](docs/demo/tapline-walkthrough.gif)

_安装并信任 CA，抓取 httpbin 请求，编辑并重发，与原请求 Diff，再用工作区的 `.proto`
解出 grpcbin 的字段名。_ [MP4](docs/demo/tapline-walkthrough.mp4) ·
[录制说明](docs/demo/README.md)

## 功能

- **流量面板** — 侧边栏是 _结构_ 树（主机 → 路径 → 请求），编辑区只有一个面板：可排序、
  虚拟滚动的 _序列_ 表格（状态码/方法快捷筛选、按主机查看、多选、可调列宽），详情放在
  下方或右侧。
- **详情** — 请求与响应并排：带时序瀑布图的概览、Raw、参数（Query、Cookie、表单、
  multipart、JWT 解码）、Headers 与 Trailers，正文支持 JSON 树 / XML / 文本 / 十六进制 /
  图片并可在正文中查找。gzip、deflate、br、zstd 正文自动解码。
- **流式消息** — WebSocket 帧、SSE 事件、gRPC 消息实时到达；可搜索、单条复制、暂停与
  跟随最新、按方向筛选，并在原连接上重发 WebSocket 消息。
- **gRPC** — 拆出 length-prefixed 消息（含 gzip/deflate 与 gRPC-Web），用工作区的
  `.proto` 解出字段名，没有 schema 时按字段编号解码；`grpc-status` 决定行的颜色。
- **过滤语法** — 支持 `status:5xx`、`method:post`、`host:api.*`、`path:/v1`、
  `type:json`、`proto:grpc`、`size>10k`、`dur>500`、`ip:10.0.`、`body:"not found"`、
  `header:x-id=1`、`rule:any` 以及 `-status:2xx` 这样的取反；普通词匹配 URL、方法或
  状态码。_统计_ 按主机汇总当前过滤出的请求。
- **规则** — 断点、改写、映射到本地、映射到远程、拦截和限速（[见下文](#规则)）。
- **发送与对比** — 从零编写请求、粘贴 curl 命令，或对抓到的请求 _编辑并重发_；任选两行或
  重发记录与原请求，在 VS Code 原生差异编辑器中对比。备注与星标在本次会话内标注请求。
- **自动抓包** — 新终端和调试会话（`node`、`python`、`go`、`java`……按调试类型自动选择）自动获得
  `HTTP(S)_PROXY` 和常见工具的 CA 变量（`SSL_CERT_FILE`、`NODE_EXTRA_CA_CERTS`、
  `REQUESTS_CA_BUNDLE`、`CURL_CA_BUNDLE`、`GIT_SSL_CAINFO`、`JAVA_TOOL_OPTIONS`……）；
  其他程序用 _复制代理环境变量_。
- **根证书** — 在 macOS、Windows、Linux 的系统证书存储中一键安装、信任和卸载 CA
  （[见下文](#根证书)）。
- **每个窗口独立抓包** — 每个 VS Code 窗口拥有独立的流量、控制和系统分配的代理端口；
  同一扩展存储下的窗口共用一个 sing-box 进程和 CA，最后关闭的窗口负责关停。
- **MCP 服务器** — Copilot Chat、Claude Code、Cursor 等助手可以列出、搜索、读取、重放
  和发送抓到的请求（[见下文](#mcp-服务器)）。
- 复制为 cURL、导出 HAR、状态栏控制、中英文界面。

## 编写请求

打开 _Tapline: 新建请求…_，将 cURL 命令粘贴到编辑器，或使用顶部的 _cURL_ 导入按钮。
解析使用 curlconverter，支持多行命令和 UTF-8 数据文件，例如
`curl -d @data.json https://example.com/api`。发送前请查看导入警告：文件缺失、multipart
文件引用及无法映射的传输选项都会提示；上传二进制文件请在 Body 中选择文件。

- **Params 和 Headers：** 以键值行编辑，勾选要发送的条目；取消勾选的内容仍保留在
  编辑器中。Headers 也支持批量文本编辑。
- **Authorization：** 配置 Basic、Bearer 或自定义 Authorization 请求头。
- **Body：** 支持 `none`、`form-data`、`x-www-form-urlencoded`、`raw`、`binary` 和
  `GraphQL`。multipart 支持文本和文件字段；URL 编码表单支持勾选、描述和批量编辑；
  binary 按原始字节发送所选文件。GraphQL 提供 Query、Variables 和 Operation Name，
  并校验变量 JSON。
- 按 **⌘↩ / Ctrl+↩** 发送，然后查看捕获结果或与原请求对比。

[ReqBin 测试覆盖报告](docs/reqbin-curl-coverage.md)列出了已验证的示例和导入限制。

## 设置

_Tapline: 设置_（或流量面板的齿轮）打开带搜索的设置标签页。设置和规则保存在扩展的
全局存储中，同一 VS Code 配置文件下的所有项目共用，不写入 `settings.json`。

| 设置项                                      | 默认值           | 作用                               |
| ------------------------------------------- | ---------------- | ---------------------------------- |
| `tapline.autoStart`                         | `false`          | VS Code 启动时自动开始抓包         |
| `tapline.terminal.profiles`                 | openssl, git     | 向新终端注入的变量                 |
| `tapline.ssl.hosts`                         | `["*"]`          | 解密哪些主机（`[]` 表示不解密）    |
| `tapline.maxEntries` / `tapline.maxBodyKiB` | `2000` / `512`   | 保留的请求数与正文字节数           |
| `tapline.mcp.enabled` / `tapline.mcp.port`  | `true` / `3607`  | 供 AI 助手使用的 MCP 端点          |
| `tapline.grpc.protoFiles`                   | `["**/*.proto"]` | 解码 gRPC 消息用的 schema          |
| `tapline.rules`                             | `[]`             | 拦截规则，用 _Tapline: 规则…_ 编辑 |

## 规则

规则按顺序应用于 URL 匹配通配模式（`*` 匹配任意内容，不含 `*` 时按前缀匹配，留空匹配
全部）且方法匹配（可选）的每个请求。点击尺子按钮或 _Tapline: 规则…_ 打开编辑器；行的
右键菜单中的 _在此 URL 上设置断点_ 直接添加断点。规则数据示例：

```jsonc
[
    {
        "kind": "breakpoint",
        "url": "https://api.example.com/v1/orders*",
        "request": true,
        "response": true
    },
    {
        "kind": "rewrite",
        "url": "*/v1/*",
        "request": { "headers": { "X-Debug": "1", "Authorization": null } },
        "response": {
            "status": 500,
            "bodyReplace": { "pattern": "\"ok\":true", "replacement": "\"ok\":false" }
        }
    },
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
不会被缓冲，只能改状态码和头。被规则处理过的请求在列表中显示铅笔图标，概览里列出规则名。

## 根证书

CA 位于扩展的全局存储目录（_Tapline: 复制根证书路径_）。只有系统信任了 CA 才会开始
抓包；侧边栏和状态栏会提示安装，_Tapline: 卸载根证书_ 可将其移除。

| 平台    | 证书存储                                              |
| ------- | ----------------------------------------------------- |
| macOS   | 登录钥匙串，通过 `security`（系统密码对话框）         |
| Windows | 当前用户受信任的根证书，通过 `certutil`（确认对话框） |
| Linux   | 发行版锚点目录 + 更新命令，在终端中以 `sudo` 执行     |

Firefox 和 snap/flatpak 浏览器使用自己的证书存储，需要手动导入。将
`tapline.ssl.hosts` 设为 `[]` 可在不解密、不安装证书的情况下抓包。

## MCP 服务器

只要有窗口加载了 Tapline，抓包代理就在 `http://127.0.0.1:3607/mcp` 提供
[MCP](https://modelcontextprotocol.io) 端点（Streamable HTTP，仅监听本地回环，无额外
进程）。工具：`list_sessions`、`status`、`list_requests`、`search`、`get_request`、
`get_body`、`replay`、`send`、`export_har`、`start_capture`、`stop_capture`、
`set_recording`、`clear`、`delete`；资源 `tapline://sessions/{sessionId}/requests/{id}`。
窗口隔离下每个窗口是一个会话：`list_sessions` 列出它们，其他工具接受 `sessionId`
（多个窗口时必填）。

_Tapline: 配置 MCP 服务器…_ 提供一键安装到 Cursor、复制 URL、`mcp.json` 片段或
`claude mcp add` 命令。

## 工作原理

Node agent 驱动随扩展打包的、打了补丁的 [sing-box](third_party/patches/sing-box/README.md)：
sing-box 用 Tapline CA 签发的叶证书终止 TLS，把正文流式传给 agent，后者记录、应用规则
后转发。

## 开发

需要 Node 24 LTS、Go 1.27+ 和 git。

```sh
git clone --recurse-submodules https://github.com/fqix/tapline.git && cd tapline
nvm use               # Node 24 LTS (.nvmrc)
npm ci --ignore-scripts # 使用 WASM 解析器，跳过未使用的原生插件
npm rebuild esbuild
npm run core:build     # 打补丁并构建 sing-box 到 core/<platform>-<arch>/
npm run build          # esbuild → dist/
npm test               # vitest：单元测试 + 针对核心的集成测试
npm run test:e2e       # 在真实 VS Code 中运行扩展（首次运行会下载 VS Code）
npm run package        # 当前平台的 VSIX（package:all 构建全部六个）
```

按 F5 启动扩展开发宿主。CI 在每次 push 时构建、测试并打包所有平台，并在每个操作系统的
一台 runner 上运行端到端测试。

## 发版

Push/PR CI 只构建和测试。在 [CHANGELOG.md](CHANGELOG.md) 中加入新版本，升级版本号、推送 tag，然后
在 GitHub 上发布 release：

```sh
npm version patch && git push --follow-tags
```

[release 工作流](.github/workflows/release.yml)会重新构建所有平台，发布到 VS Code
Marketplace（通过 OIDC 以 Azure 托管标识登录，不用 PAT）和 Open VSX，并把 VSIX 附加到
release 上。

## 许可证

MIT。随扩展打包的 sing-box 核心为 GPL-3.0，其源码修订、补丁和声明随每个二进制一起发布。
