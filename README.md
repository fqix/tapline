# Tapline

English | [简体中文](README.zh-CN.md)

Capture and inspect HTTP, HTTPS, HTTP/2, HTTP/3, gRPC, WebSocket and SSE traffic
without leaving VS Code. Integrated terminals and debug sessions are routed through a
local proxy that decrypts TLS with its own root CA; nothing else on the system changes.

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
or [Open VSX](https://open-vsx.org/extension/fqix/tapline).

## Features

- **Charles-style views** — a _Structure_ tree (host → path → request) in the sidebar
  and one traffic panel: a sortable, filterable _Sequence_ table (status / method quick
  filters, per-host view) with an inspector below or beside it. The inspector shows an
  overview with timing waterfall, request and response pages (headers, query, cookies,
  form, trailers, body as Pretty JSON / Text / Hex), WebSocket frames and SSE events
  streamed live.
- **gRPC decoding** — messages are split out of the length-prefixed body (gzip/deflate
  and gRPC-Web included) and decoded with the workspace's `.proto` files
  (`tapline.grpc.protoFiles`) or, without a schema, by field number; `grpc-status` drives
  the status colour and the method column reads _gRPC_.
- **Automatic capture** — new terminals and debug sessions (`node`, `python`, `go`,
  `java`, … configurable) get `HTTP(S)_PROXY` and the CA variables of common tools
  (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`,
  `GIT_SSL_CAINFO`, `JAVA_TOOL_OPTIONS`, …).
- **One-click root certificate** — install, trust and uninstall the CA in the OS
  store on macOS, Windows and Linux. Capture waits until the CA is trusted.
- **Copy as cURL, export HAR, replay**, status-bar controls, English and 简体中文 UI.
- **Shared core** — all VS Code windows use one capture agent; the last one to
  close shuts it down.
- **MCP server** — Copilot Chat, Claude Code, Cursor and other MCP clients can list,
  search, read, replay and send captured requests (see below).

## Settings

| Setting                                     | Default          | Purpose                                   |
| ------------------------------------------- | ---------------- | ----------------------------------------- |
| `tapline.port`                              | `3606`           | Loopback port of the capture proxy        |
| `tapline.autoStart`                         | `false`          | Start capture when VS Code opens          |
| `tapline.terminal.inject`                   | `true`           | Inject variables into new terminals       |
| `tapline.debug.inject` / `debug.types`      | `true` / node, … | Inject into launched debug sessions       |
| `tapline.ssl.enabled` / `tapline.ssl.hosts` | `true` / `["*"]` | Which hosts are decrypted                 |
| `tapline.maxEntries` / `tapline.maxBodyKiB` | `2000` / `512`   | Transactions kept and body bytes retained |
| `tapline.mcp.enabled` / `tapline.mcp.port`  | `true` / `3607`  | MCP endpoint for AI assistants            |
| `tapline.grpc.protoFiles`                   | `["**/*.proto"]` | Schemas for decoding gRPC messages        |

## Root certificate

The CA lives in the extension's global storage (`Tapline: Copy Root Certificate Path`).
With `tapline.ssl.enabled` on, capture starts only once the OS trusts it; the sidebar
and status bar offer to install it, and `Tapline: Uninstall Root Certificate` removes it.

| Platform | Store                                                           |
| -------- | --------------------------------------------------------------- |
| macOS    | login keychain via `security` (system password dialog)          |
| Windows  | current-user Trusted Root via `certutil` (confirmation dialog)  |
| Linux    | distribution anchor directory + update command, run with `sudo` |

Firefox and snap/flatpak browsers keep their own stores and need a manual import.
Set `tapline.ssl.enabled` to `false` to capture without decryption or any certificate.

## MCP server

The capture agent serves an [MCP](https://modelcontextprotocol.io) endpoint at
`http://127.0.0.1:3607/mcp` (Streamable HTTP; port and on/off in `tapline.mcp.*`) so AI
assistants can work from real traffic: `status`, `list_requests`, `search`, `get_request`,
`get_body`, `replay`, `send`, `export_har`, plus `start_capture` / `stop_capture` /
`set_recording` / `clear` / `delete`, and `tapline://requests/{id}` resources.

Run _Tapline: Configure MCP Server…_ (also in the traffic view's `…` menu) for a one-click
install in Cursor, the URL, an `mcp.json` snippet, or a `claude mcp add` command. The
endpoint is up while any window with Tapline is open — no extra process, no `node` on
`PATH` — and, like the proxy, listens on the loopback interface only.

## How it works

A Node agent drives a bundled, patched [sing-box](third_party/patches/sing-box/README.md):
sing-box terminates TLS with leaf certificates minted from the Tapline CA and streams
bodies through the agent, which records them and passes them on unchanged.

## Development

Requires Node 22+, Go 1.27+ and git.

```sh
git clone --recurse-submodules https://github.com/fqix/tapline.git && cd tapline
npm ci
npm run core:build     # patch and build sing-box into core/<platform>-<arch>/
npm run build          # esbuild → dist/
npm test               # vitest
npm run package        # VSIX for this platform (package:all for all six)
```

Press F5 to launch the extension development host. CI builds, tests and packages every
platform on each push.

## Releasing

CI never publishes. Bump the version, push the tag and publish a GitHub release:

```sh
npm version patch && git push --follow-tags
```

The [release workflow](.github/workflows/release.yml) rebuilds all platforms, publishes
to the VS Code Marketplace (Azure managed identity over OIDC, no PAT) and Open VSX, and
attaches the VSIX files to the release.

## Licence

MIT. The bundled sing-box core is GPL-3.0; its source revision, patches and notices ship
next to each binary.
