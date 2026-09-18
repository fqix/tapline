# Tapline

[English](README.md) | 简体中文

不离开 VS Code 即可捕获并检查 HTTP、HTTPS、HTTP/2、HTTP/3、gRPC、WebSocket 和
Server-Sent Events 流量。Tapline 把集成终端和调试会话路由到本地抓包代理，用自己的根
CA 解密 TLS，并在侧边栏展示每个请求——不修改系统代理；VS Code 之外唯一的改动是你
选择信任的根证书（随时可一键卸载）。

从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
或 [Open VSX](https://open-vsx.org/extension/fqix/tapline) 安装。

## 功能

- **Charles 风格视图** — 侧边栏是 _结构_ 树（主机 → 路径目录 → 请求）；_序列_ 视图
  是一张可排序、可筛选的表格（状态码、方法、主机、路径、开始时间、耗时、大小），下方
  显示所选请求的详情，每行可重放。请求详情包含 _概览_（状态、协议、客户端、大小、
  时序瀑布图）和 _内容_——请求在上、响应在下，各有 Headers / Text / JSON / Raw / Hex
  子标签，存在时还有 Query String、Cookies 和 Form——WebSocket 显示 _Frames_，
  `text/event-stream` 响应显示 _SSE 事件_，连接打开期间都实时刷新。点击主机可查看其
  汇总（状态码、内容类型、协议、耗时、字节数）和可筛选的请求列表。正文可作为编辑器
  文档打开，整个交换过程也可导出为文本。
- **终端与调试抓包** — 抓包运行期间，新建的集成终端和调试会话（`node`、`python`、
  `go`、`java`……可配置）会自动获得 `HTTP(S)_PROXY` 以及各工具的 CA 变量：
  `SSL_CERT_FILE`、`NODE_EXTRA_CA_CERTS`（Node 22.21+/24 的 `fetch` 另加
  `NODE_USE_ENV_PROXY`）、`REQUESTS_CA_BUNDLE`、`PIP_CERT`、`CURL_CA_BUNDLE`、
  `GIT_SSL_CAINFO`、`AWS_CA_BUNDLE`、`npm_config_cafile`、`CARGO_HTTP_CAINFO`、
  `DENO_CERT`、`GRPC_DEFAULT_SSL_ROOTS_FILE_PATH` 和 `JAVA_TOOL_OPTIONS`（代理系统属性
  加一个包含 Mozilla 根证书与 Tapline CA 的 PKCS#12 信任库），忽略系统证书存储的工具
  也能信任该 CA。
- **一键根证书** — _安装_、_信任_ 和 _卸载根证书_ 命令在操作系统证书存储中管理 CA：
  macOS（登录钥匙串）、Windows（当前用户受信任的根证书颁发机构）和 Linux（通过 `sudo`
  写入发行版锚点目录）。证书未被信任时抓包不会启动，HTTPS 解密不会静默失败。
- **状态栏控制** — 开始/停止抓包、暂停录制、打开抓包终端、安装或移除证书。
- **复制为 cURL、导出 HAR、重放** — 重放经由代理发出，和普通请求一样被记录。
- **共享核心** — 所有 VS Code 窗口共用一个抓包代理进程；最后关闭的窗口负责关停它
  （连同 sing-box）。
- 界面支持英文和简体中文。

## 工作原理

```
VS Code 窗口 ─┐                              ┌─ sing-box（打补丁，随插件打包）
VS Code 窗口 ─┼─ 本地套接字 ─▶ agent (Node) ─┤   fluxy-mixed 入站  :3606
VS Code 窗口 ─┘                    │          └─ fluxy-inspector 服务
                                   └─ Tapline 根 CA、事务存储
```

`src/core` 实现 inspector 的帧式 stdin/stdout 协议：sing-box 用 Tapline 根 CA 签发的
叶证书终止 TLS，把请求和响应正文流式传给 agent，后者记录后原样返回。不匹配
`tapline.ssl.hosts` 的主机以不透明隧道直接转发。核心的构建方式见
[third_party/patches/sing-box/README.md](third_party/patches/sing-box/README.md)。

## 设置

| 设置项                                      | 默认值              | 作用                         |
| ------------------------------------------- | ------------------- | ---------------------------- |
| `tapline.port`                              | `3606`              | 抓包代理监听的回环端口       |
| `tapline.autoStart`                         | `false`             | VS Code 启动时自动开始抓包   |
| `tapline.terminal.inject`                   | `true`              | 向新终端注入代理/CA 变量     |
| `tapline.debug.inject`                      | `true`              | 向启动的调试会话注入这些变量 |
| `tapline.debug.types`                       | node, python, go, … | 接收变量的调试配置类型       |
| `tapline.ssl.enabled` / `tapline.ssl.hosts` | `true` / `["*"]`    | 解密哪些主机                 |
| `tapline.maxEntries`                        | `2000`              | 内存中保留的实时事务数       |
| `tapline.maxBodyKiB`                        | `512`               | 每个方向保留的正文字节数     |

### 根证书

根证书位于插件的全局存储目录（`Tapline: 复制根证书路径`）：`ca.pem`、私钥 `ca.key`
（0600）和 `ca.p12`（Java 信任库，密码 `changeit`）。开启 `tapline.ssl.enabled` 时，
只有操作系统信任了该 CA 抓包才会启动；侧边栏、状态栏菜单和开始命令都会提示安装，
`Tapline: 卸载根证书` 可再次移除。

| 平台    | 安装 / 信任                                                                                                                                                                     | 卸载                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| macOS   | 在登录钥匙串中执行 `security add-certificates` / `add-trusted-cert -r trustRoot`（弹出系统密码对话框）                                                                          | `security remove-trusted-cert` + `delete-certificate` |
| Windows | `certutil -user -addstore Root`（Windows 确认对话框）                                                                                                                           | `certutil -user -delstore Root <sha1>`                |
| Linux   | 写入 `/usr/local/share/ca-certificates`、`/etc/pki/ca-trust/source/anchors` 或 `/etc/ca-certificates/trust-source/anchors` 锚点，再运行发行版的更新命令，在终端中以 `sudo` 执行 | 删除锚点并重新运行更新命令                            |

macOS 上 _安装_ 和 _信任_ 是两个独立步骤（证书可以存在于钥匙串中但未被信任）；其他
平台安装即信任。Firefox 和 snap/flatpak 浏览器使用自己的证书存储，需要手动导入。将
`tapline.ssl.enabled` 设为 `false` 可在不解密、不安装任何证书的情况下抓包。

## 目录结构

```
src/
├── extension.ts                 # activate/deactivate：命令、状态栏、装配
├── client/agentClient.ts        # 连接（或启动）共享的抓包 agent
├── views/trafficView.ts         # 侧边栏 TreeDataProvider（结构 / 序列）
├── panels/detailPanel.ts        # webview 面板宿主：事务详情、主机概览
├── webview/                     # React UI，打包为 dist/webview.js（浏览器 tsconfig）
│   ├── main.tsx, App.tsx        #   入口与根组件
│   ├── components/              #   TransactionView、ContentsView、MessagePane、SequenceView、HostView……
│   ├── hooks/                   #   useHostMessages（宿主 → 面板消息流）
│   ├── lib/                     #   vscode api 桥接、i18n
│   ├── styles/                  #   跟随主题的 CSS（VS Code 变量）
│   └── types/                   #   宿主 ↔ 面板消息契约
├── providers/transactionDocuments.ts  # 只读 tapline:/ 虚拟文档
├── environment/captureEnvironment.ts  # 终端 + 调试环境注入
├── environment/systemTrust.ts   # 操作系统证书存储的安装/信任/卸载
├── utils/format.ts              # 渲染辅助（不依赖 vscode）
├── agent/                       # 共享守护进程入口、套接字协议
├── core/                        # sing-box 控制器、CA、抓包引擎
├── shared/model.ts              # 数据契约（Transaction、HAR、cURL）
└── test/                        # vitest 测试与辅助
```

## 开发

前置条件：Node 22+、Go 1.27+、git。

```sh
git clone --recurse-submodules https://github.com/fqix/tapline.git
cd tapline
# 如果克隆时没有加 --recurse-submodules：
git submodule update --init --recursive

npm ci
npm run core:build          # 给 sing-box 子模块打补丁，构建 core/<platform>-<arch>/
npm run build               # esbuild → dist/extension.js + dist/agent.js
npm test                    # vitest：协议、引擎、WebSocket 中继、共享 agent（使用已构建的核心）
npm run typecheck
npm run package             # 当前平台的 VSIX；`npm run package:all` 构建全部六个目标
```

在 VS Code 中按 F5 启动扩展开发宿主。`npm run core:test` 运行打补丁的 Go 包的测试。

[GitHub Actions CI](https://github.com/fqix/tapline/actions/workflows/ci.yml) 在
push、pull request 和手动触发时运行。使用 Node 22 和
`third_party/patches/sing-box/pin.json` 中固定的 Go 版本，检查格式与类型、构建核心、
在 Linux、macOS 和 Windows 上运行打补丁的 Go 测试（开启竞态检测与 vet）及 Vitest
测试，并为每个平台打包 x64 和 arm64 的 VSIX 产物（保留 14 天）。

## 发版

CI 从不发布。升级版本号、推送 tag，然后在 GitHub 上为该 tag 发布 release：

```sh
npm version patch && git push --follow-tags
```

[release 工作流](.github/workflows/release.yml)会重新构建全部六个平台包，发布到
VS Code Marketplace（通过 OIDC 以托管标识登录 Azure，不使用个人访问令牌）和
Open VSX，并把 VSIX 文件附加到 release 上。它会校验 release tag 与 `package.json`
中的版本一致。

## 许可证

Tapline 采用 MIT 许可证。随插件打包的 sing-box 核心为 GPL-3.0；其源码修订、补丁和
汇总的声明随每个二进制一起发布（`core/*/sing-box.build.json`、
`sing-box.licenses.txt`）。
