# Tapline

Capture and inspect HTTP, HTTPS, HTTP/2, HTTP/3, gRPC and WebSocket traffic without
leaving VS Code. Tapline routes the integrated terminal and debug sessions through a
local capture proxy, decrypts TLS with its own root CA, and shows every request in the
sidebar — no system proxy, no admin rights, nothing changes outside VS Code.

在 VS Code 内捕获并检查集成终端与调试会话发出的 HTTP/HTTPS/HTTP2/HTTP3/gRPC/WebSocket 流量。
不修改系统代理，不需要管理员权限。

## Features

- **Structure view** — Charles-style tree: host → path folders → requests, or a flat
  sequence view. Click a host for its overview (counts, status codes, bytes) and a
  request for the detail panel with Overview / Request / Response / Frames tabs,
  header tables, pretty/raw JSON bodies and a timing waterfall. Bodies can also be
  opened as editor documents (JSON/HTML/XML highlighting) or the whole exchange as text.
- **Terminal and debug capture** — while capture runs, new integrated terminals and
  debug sessions (`node`, `python`, `go`, … configurable) receive `HTTP(S)_PROXY`
  plus CA variables (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`,
  `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, …). Tools that honour those variables are
  captured automatically; `NODE_USE_ENV_PROXY=1` covers Node 24+ `fetch`.
- **Status bar control** — start/stop capture, pause recording, open a captured
  terminal.
- **Copy as cURL, export HAR, replay** — replays go through the proxy and are
  recorded like any other request.
- **Shared core** — every VS Code window talks to one capture agent; the last window
  to close shuts it (and sing-box) down.
- English and 简体中文 UI.

## How it works

```
VS Code window ─┐                              ┌─ sing-box (patched, bundled)
VS Code window ─┼─ local socket ─▶ agent (Node) ─┤   fluxy-mixed inbound  :6070
VS Code window ─┘                    │           └─ fluxy-inspector service
                                     └─ Tapline root CA, transaction store
```

`src/core` speaks the inspector's framed stdin/stdout protocol: sing-box terminates TLS
with leaf certificates minted from the Tapline root CA and streams request and response
bodies through the agent, which records them and passes them back unchanged. Hosts not
matched by `tapline.ssl.hosts` are tunnelled opaquely. See
[third_party/sing-box/README.md](third_party/sing-box/README.md) for the core build.

## Settings

| Setting                                     | Default             | Purpose                                                                    |
| ------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| `tapline.port`                              | `6070`              | Loopback port of the capture proxy                                         |
| `tapline.autoStart`                         | `false`             | Start capture when VS Code opens                                           |
| `tapline.terminal.inject`                   | `true`              | Inject proxy/CA variables into new terminals                               |
| `tapline.debug.inject`                      | `true`              | Inject them into launched debug sessions                                   |
| `tapline.debug.types`                       | node, python, go, … | Debug configuration types that get the variables                           |
| `tapline.ssl.enabled` / `tapline.ssl.hosts` | `true` / `["*"]`    | Which hosts are decrypted                                                  |
| `tapline.maxEntries`                        | `2000`              | Live transactions kept in memory                                           |
| `tapline.maxBodyKiB`                        | `512`               | Retained body bytes per direction                                          |
| `tapline.viewMode`                          | `structure`         | `structure` groups by host and path like Charles; `sequence` lists by time |

The root certificate lives in the extension's global storage (`Tapline: Copy Root
Certificate Path`). Only processes told to trust it (via the injected variables, or by
importing it) accept intercepted connections; nothing is installed into the OS trust store.

## Layout

```
src/
├── extension.ts                 # activate/deactivate: commands, status bar, wiring
├── client/agentClient.ts        # connects to (or spawns) the shared capture agent
├── views/trafficView.ts         # sidebar TreeDataProvider (structure / sequence)
├── panels/detailPanel.ts        # webview panel host: transaction detail, host overview
├── webview/                     # React UI bundled to dist/webview.js (browser tsconfig)
├── providers/transactionDocuments.ts  # read-only tapline:/ virtual documents
├── environment/captureEnvironment.ts  # terminal + debug env injection
├── utils/format.ts              # rendering helpers (no vscode imports)
├── agent/                       # shared daemon entry, socket protocol
├── core/                        # sing-box controller, CA, capture engine
├── shared/model.ts              # data contract (Transaction, HAR, cURL)
└── test/                        # vitest suites and helpers
```

## Development

Prerequisites: Node 22+, Go 1.27+, git.

```sh
npm ci
npm run core:build          # clones sing-box at the pinned tag, applies patches, builds core/<platform>-<arch>/
npm run build               # esbuild → dist/extension.js + dist/agent.js
npm test                    # vitest: protocol, engine, WebSocket relay, shared agent (uses the built core)
npm run typecheck
npm run package             # VSIX for this platform; `npm run package:all` for all six targets
```

Press F5 in VS Code to launch the extension development host. `npm run core:test` runs
the Go tests of the patched packages.

## Licence

Tapline is MIT licensed. The bundled sing-box core is GPL-3.0; its source revision,
patches and collected notices ship next to each binary (`core/*/sing-box.build.json`,
`sing-box.licenses.txt`).
