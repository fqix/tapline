# Tapline

[English](README.md) | 简体中文

不离开 VS Code 即可捕获并检查 HTTP、HTTPS、HTTP/2、HTTP/3、gRPC、WebSocket 和 SSE
流量。集成终端和调试会话经由本地代理转发，代理用自己的根 CA 解密 TLS；系统其他部分
不受影响。

从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
或 [Open VSX](https://open-vsx.org/extension/fqix/tapline) 安装。

## 功能

- **Charles 风格视图** — _结构_ 树（主机 → 路径 → 请求）和可排序的 _序列_ 表格。每个
  请求有带时序瀑布图的概览、请求与响应内容（Headers / Text / JSON / Raw / Hex，以及
  Query、Cookies、Form），WebSocket 帧和 SSE 事件实时刷新。
- **自动抓包** — 新终端和调试会话（`node`、`python`、`go`、`java`……可配置）自动获得
  `HTTP(S)_PROXY` 和常见工具的 CA 变量（`SSL_CERT_FILE`、`NODE_EXTRA_CA_CERTS`、
  `REQUESTS_CA_BUNDLE`、`CURL_CA_BUNDLE`、`GIT_SSL_CAINFO`、`JAVA_TOOL_OPTIONS`……）。
- **一键根证书** — 在 macOS、Windows、Linux 的系统证书存储中安装、信任和卸载 CA。
  CA 未被信任时不会开始抓包。
- **复制为 cURL、导出 HAR、重放**，状态栏控制，中英文界面。
- **共享核心** — 所有 VS Code 窗口共用一个抓包代理，最后关闭的窗口负责关停。

## 设置

| 设置项                                      | 默认值           | 作用                       |
| ------------------------------------------- | ---------------- | -------------------------- |
| `tapline.port`                              | `3606`           | 抓包代理监听的回环端口     |
| `tapline.autoStart`                         | `false`          | VS Code 启动时自动开始抓包 |
| `tapline.terminal.inject`                   | `true`           | 向新终端注入变量           |
| `tapline.debug.inject` / `debug.types`      | `true` / node, … | 向启动的调试会话注入变量   |
| `tapline.ssl.enabled` / `tapline.ssl.hosts` | `true` / `["*"]` | 解密哪些主机               |
| `tapline.maxEntries` / `tapline.maxBodyKiB` | `2000` / `512`   | 保留的事务数与正文字节数   |

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
npm test               # vitest
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
