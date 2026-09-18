# Tapline

English | [简体中文](README.zh-CN.md)

Capture and inspect HTTP, HTTPS, HTTP/2, HTTP/3, gRPC, WebSocket and Server-Sent
Events traffic without leaving VS Code. Tapline routes the integrated terminal and debug
sessions through a local capture proxy, decrypts TLS with its own root CA, and shows
every request in the sidebar — no system proxy; the only thing that changes outside
VS Code is the root certificate you choose to trust (and can remove with one click).

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
or [Open VSX](https://open-vsx.org/extension/fqix/tapline).

## Features

- **Charles-style views** — the sidebar is the _Structure_ tree (host → path
  folders → requests); _Sequence_ opens a sortable, filterable table (Code, Method,
  Host, Path, Start, Duration, Size) with the selected request's detail below and
  per-row replay. A request's detail has _Overview_ (status, protocol, client, sizes,
  timing waterfall) and _Contents_ — request above, response below, each with
  Headers / Text / JSON / Raw / Hex sub-tabs plus Query String, Cookies and Form when
  present — _Frames_ for WebSockets and _SSE Events_ for `text/event-stream`
  responses, both filling in live while the connection is open. Clicking a host shows its summary (status
  codes, content types, protocols, durations, bytes) with a filterable request list.
  Bodies can also be opened as editor documents or the whole exchange as text.
- **Terminal and debug capture** — while capture runs, new integrated terminals and
  debug sessions (`node`, `python`, `go`, `java`, … configurable) receive
  `HTTP(S)_PROXY` plus per-tool CA variables: `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`
  (+ `NODE_USE_ENV_PROXY` for Node 22.21+/24 `fetch`), `REQUESTS_CA_BUNDLE`,
  `PIP_CERT`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, `AWS_CA_BUNDLE`,
  `npm_config_cafile`, `CARGO_HTTP_CAINFO`, `DENO_CERT`,
  `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`, and `JAVA_TOOL_OPTIONS` (proxy system
  properties plus a PKCS#12 trust store holding the Mozilla roots and the Tapline
  CA), so tools that ignore the OS store still trust the CA.
- **One-click root certificate** — _Install_, _Trust_ and _Uninstall Root
  Certificate_ commands manage the CA in the OS store on macOS (login keychain),
  Windows (current-user Trusted Root) and Linux (distribution anchors via `sudo`).
  Capture refuses to start until the certificate is trusted, so HTTPS decryption
  never silently fails.
- **Status bar control** — start/stop capture, pause recording, open a captured
  terminal, install or remove the certificate.
- **Copy as cURL, export HAR, replay** — replays go through the proxy and are
  recorded like any other request.
- **Shared core** — every VS Code window talks to one capture agent; the last window
  to close shuts it (and sing-box) down.
- English and 简体中文 UI.

## How it works

```
VS Code window ─┐                              ┌─ sing-box (patched, bundled)
VS Code window ─┼─ local socket ─▶ agent (Node) ─┤   fluxy-mixed inbound  :3606
VS Code window ─┘                    │           └─ fluxy-inspector service
                                     └─ Tapline root CA, transaction store
```

`src/core` speaks the inspector's framed stdin/stdout protocol: sing-box terminates TLS
with leaf certificates minted from the Tapline root CA and streams request and response
bodies through the agent, which records them and passes them back unchanged. Hosts not
matched by `tapline.ssl.hosts` are tunnelled opaquely. See
[third_party/patches/sing-box/README.md](third_party/patches/sing-box/README.md) for the core build.

## Settings

| Setting                                     | Default             | Purpose                                          |
| ------------------------------------------- | ------------------- | ------------------------------------------------ |
| `tapline.port`                              | `3606`              | Loopback port of the capture proxy               |
| `tapline.autoStart`                         | `false`             | Start capture when VS Code opens                 |
| `tapline.terminal.inject`                   | `true`              | Inject proxy/CA variables into new terminals     |
| `tapline.debug.inject`                      | `true`              | Inject them into launched debug sessions         |
| `tapline.debug.types`                       | node, python, go, … | Debug configuration types that get the variables |
| `tapline.ssl.enabled` / `tapline.ssl.hosts` | `true` / `["*"]`    | Which hosts are decrypted                        |
| `tapline.maxEntries`                        | `2000`              | Live transactions kept in memory                 |
| `tapline.maxBodyKiB`                        | `512`               | Retained body bytes per direction                |

### Root certificate

The root certificate lives in the extension's global storage (`Tapline: Copy Root
Certificate Path`): `ca.pem`, the private key `ca.key` (0600) and `ca.p12`, a Java trust
store (password `changeit`). With `tapline.ssl.enabled` on, capture only starts once the
operating system trusts the CA; the sidebar, the status-bar menu and the start command
all offer to install it, and `Tapline: Uninstall Root Certificate` removes it again.

| Platform | Install / Trust                                                                                                                                                                                        | Uninstall                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| macOS    | `security add-certificates` / `add-trusted-cert -r trustRoot` in the login keychain (system password dialog)                                                                                           | `security remove-trusted-cert` + `delete-certificate` |
| Windows  | `certutil -user -addstore Root` (Windows confirmation dialog)                                                                                                                                          | `certutil -user -delstore Root <sha1>`                |
| Linux    | anchor in `/usr/local/share/ca-certificates`, `/etc/pki/ca-trust/source/anchors` or `/etc/ca-certificates/trust-source/anchors`, then the distribution's update command, run with `sudo` in a terminal | remove the anchor and rerun the update command        |

On macOS _Install_ and _Trust_ are separate steps (a certificate can sit in the keychain
untrusted); elsewhere installing implies trust. Firefox and snap/flatpak browsers keep
their own stores and need a manual import. Set `tapline.ssl.enabled` to `false` to
capture without decryption and without any certificate.

## Layout

```
src/
├── extension.ts                 # activate/deactivate: commands, status bar, wiring
├── client/agentClient.ts        # connects to (or spawns) the shared capture agent
├── views/trafficView.ts         # sidebar TreeDataProvider (structure / sequence)
├── panels/detailPanel.ts        # webview panel host: transaction detail, host overview
├── webview/                     # React UI bundled to dist/webview.js (browser tsconfig)
│   ├── main.tsx, App.tsx        #   entry and root component
│   ├── components/              #   TransactionView, ContentsView, MessagePane, SequenceView, HostView, …
│   ├── hooks/                   #   useHostMessages (host → panel message stream)
│   ├── lib/                     #   vscode api bridge, i18n
│   ├── styles/                  #   theme-aware CSS (VS Code variables)
│   └── types/                   #   host ↔ panel message contract
├── providers/transactionDocuments.ts  # read-only tapline:/ virtual documents
├── environment/captureEnvironment.ts  # terminal + debug env injection
├── environment/systemTrust.ts   # install / trust / uninstall the CA in the OS store
├── utils/format.ts              # rendering helpers (no vscode imports)
├── agent/                       # shared daemon entry, socket protocol
├── core/                        # sing-box controller, CA, capture engine
├── shared/model.ts              # data contract (Transaction, HAR, cURL)
└── test/                        # vitest suites and helpers
```

## Development

Prerequisites: Node 22+, Go 1.27+, git.

```sh
git clone --recurse-submodules https://github.com/fqix/tapline.git
cd tapline
# if you already cloned without --recurse-submodules:
git submodule update --init --recursive

npm ci
npm run core:build          # applies patches to the sing-box submodule, builds core/<platform>-<arch>/
npm run build               # esbuild → dist/extension.js + dist/agent.js
npm test                    # vitest: protocol, engine, WebSocket relay, shared agent (uses the built core)
npm run typecheck
npm run package             # VSIX for this platform; `npm run package:all` for all six targets
```

Press F5 in VS Code to launch the extension development host. `npm run core:test` runs
the Go tests of the patched packages.

[GitHub Actions CI](https://github.com/fqix/tapline/actions/workflows/ci.yml) runs on
pushes, pull requests and manual dispatches. With Node 22 and the Go version from
`third_party/patches/sing-box/pin.json`, it checks formatting and types, builds the core,
runs the patched Go tests (with race detection and vet) and the Vitest suites on Linux,
macOS and Windows, and packages x64 and arm64 VSIX artifacts for each platform
(retained for 14 days).

## Releasing

CI never publishes. Bump the version, push the tag, then publish a GitHub release for it:

```sh
npm version patch && git push --follow-tags
```

The [release workflow](.github/workflows/release.yml) rebuilds all six platform packages,
publishes them to the VS Code Marketplace (signing in to Azure with a managed identity
over OIDC — no personal access token) and Open VSX, and attaches the VSIX files to the
release. It checks that the release tag matches `package.json`.

## Licence

Tapline is MIT licensed. The bundled sing-box core is GPL-3.0; its source revision,
patches and collected notices ship next to each binary (`core/*/sing-box.build.json`,
`sing-box.licenses.txt`).
