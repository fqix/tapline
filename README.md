# Tapline

English | [简体中文](README.zh-CN.md)

[![VS Code Marketplace installs](https://vsmarketplacebadges.dev/installs-short/fqix.tapline.svg?label=VS%20Code%20Marketplace%20installs)](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/fqix/tapline?label=Open%20VSX%20downloads)](https://open-vsx.org/extension/fqix/tapline)

Capture, inspect, rewrite and replay HTTP, HTTPS, HTTP/2, HTTP/3, gRPC, WebSocket and
SSE traffic without leaving VS Code. Integrated terminals and debug sessions are routed
through a local proxy that decrypts TLS with its own root CA; nothing else on the system
changes.

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fqix.tapline)
or [Open VSX](https://open-vsx.org/extension/fqix/tapline).

![Tapline: certificate setup, HTTP capture, replay, diff and decoded gRPC fields](docs/demo/tapline-walkthrough.gif)

_Install and trust the CA, capture an httpbin request, edit & resend it, diff it against
the original, decode grpcbin fields with the workspace `.proto`._
[MP4](docs/demo/tapline-walkthrough.mp4) · [recording notes](docs/demo/README.md)

## Features

- **Traffic panel** — a _Structure_ tree (host → path → request) in the sidebar and one
  panel with a sortable, virtualised _Sequence_ table (status/method chips, host view,
  multi-select, resizable columns) and an inspector below or beside it.
- **Inspector** — request and response side by side: Overview with timing waterfall,
  Raw, Params (query, cookies, form, multipart, decoded JWTs), Headers and trailers,
  Body as JSON tree / XML / Text / Hex / image with find-in-body. gzip, deflate, br and
  zstd bodies are decoded.
- **Streams** — WebSocket frames, SSE events and gRPC messages arrive live; search,
  copy, pause and follow, filter by direction, resend a WebSocket message on the open
  connection.
- **gRPC** — length-prefixed messages (gzip/deflate, gRPC-Web) decoded with the
  workspace's `.proto` files or, without a schema, by field number; `grpc-status` colours
  the row.
- **Filter query** — terms such as `status:5xx`, `method:post`, `host:api.*`,
  `path:/v1`, `type:json`, `proto:grpc`, `size>10k`, `dur>500`, `ip:10.0.`,
  `body:"not found"`, `header:x-id=1`, `rule:any` and negations like `-status:2xx`; plain
  words match URL, method or status. _Statistics_ summarises the filtered rows per host.
- **Rules** — breakpoints, rewrite, map local, map remote, block and throttle
  ([below](#rules)).
- **Compose and compare** — write a request, paste a curl command, or _Edit & Resend_ a
  captured one; compare any two rows, or a replay with its original, in the native diff
  editor. Notes and markers annotate requests for the session.
- **Automatic capture** — new terminals and debug sessions (`node`, `python`, `go`,
  `java`, … configurable) get `HTTP(S)_PROXY` plus the CA variables of common tools
  (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`,
  `GIT_SSL_CAINFO`, `JAVA_TOOL_OPTIONS`, …); _Copy Proxy Environment_ for anything else.
- **Root certificate** — install, trust and uninstall the CA in the OS store on macOS,
  Windows and Linux with one click ([below](#root-certificate)).
- **One capture per window** — every VS Code window has its own traffic, controls and
  OS-assigned proxy port; windows in the
  same extension storage share one sing-box process and CA, and the last window to
  close shuts them down.
- **MCP server** — Copilot Chat, Claude Code, Cursor and other assistants can list,
  search, read, replay and send captured requests ([below](#mcp-server)).
- Copy as cURL, export HAR, status-bar controls, English and 简体中文 UI.

## Settings

_Tapline: Settings_ (or the gear in the traffic panel) opens a settings tab with search.
Settings and rules live in the extension's global storage and are shared by every project
in the same VS Code profile; `settings.json` is not used.

| Setting                                     | Default          | Purpose                                           |
| ------------------------------------------- | ---------------- | ------------------------------------------------- |
| `tapline.autoStart`                         | `false`          | Start capture when VS Code opens                  |
| `tapline.terminal.profiles`                 | openssl, git     | Variables injected into new terminals             |
| `tapline.ssl.hosts`                         | `["*"]`          | Which hosts are decrypted (`[]` for none)         |
| `tapline.maxEntries` / `tapline.maxBodyKiB` | `2000` / `512`   | Requests kept and body bytes retained             |
| `tapline.mcp.enabled` / `tapline.mcp.port`  | `true` / `3607`  | MCP endpoint for AI assistants                    |
| `tapline.grpc.protoFiles`                   | `["**/*.proto"]` | Schemas for decoding gRPC messages                |
| `tapline.rules`                             | `[]`             | Interception rules, edited with _Tapline: Rules…_ |

## Rules

Rules apply in order to every request whose URL matches the wildcard pattern (`*`
matches anything, a pattern without `*` is a prefix, empty matches all) and, optionally,
one of the listed methods. Open the editor with the ruler button or _Tapline: Rules…_;
_Break on This URL_ in a row's context menu adds a breakpoint. Example rule data:

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

| Kind         | Effect                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `breakpoint` | Holds the request and/or response; the inspector shows an editor with _Continue_ and _Abort_.             |
| `rewrite`    | `method`, `url` (regex → replacement), `status`, `headers` (`null` removes), `body` or `bodyReplace`.     |
| `mapLocal`   | Answers with `file` (relative to the workspace or absolute) or `body`; `contentType` is guessed if unset. |
| `mapRemote`  | Sends the request to `to` (origin, optional path prefix), keeping the path and query; `Host` follows.     |
| `block`      | Refuses with `status` (default 403) without contacting the server.                                        |
| `throttle`   | Delays forwarding by `latencyMs` and paces both bodies at `kbps`.                                         |

Rewritten and edited bodies are sent uncompressed with `Content-Encoding` removed;
`text/event-stream` responses are never buffered, so only their status and headers can
change. Requests a rule touched show a pencil in the table and the rule names in the
overview.

## Root certificate

The CA lives in the extension's global storage (_Tapline: Copy Root Certificate Path_).
Capture starts only once the OS trusts it; the sidebar and status bar offer to install
it, and _Tapline: Uninstall Root Certificate_ removes it.

| Platform | Store                                                           |
| -------- | --------------------------------------------------------------- |
| macOS    | login keychain via `security` (system password dialog)          |
| Windows  | current-user Trusted Root via `certutil` (confirmation dialog)  |
| Linux    | distribution anchor directory + update command, run with `sudo` |

Firefox and snap/flatpak browsers keep their own stores and need a manual import. Set
`tapline.ssl.hosts` to `[]` to capture without decryption or any certificate.

## MCP server

The capture agent serves an [MCP](https://modelcontextprotocol.io) endpoint at
`http://127.0.0.1:3607/mcp` (Streamable HTTP, loopback only, no extra process) while any
window with Tapline is open. Tools: `list_sessions`, `status`, `list_requests`, `search`,
`get_request`, `get_body`, `replay`, `send`, `export_har`, `start_capture`,
`stop_capture`, `set_recording`, `clear`, `delete`; resources
`tapline://sessions/{sessionId}/requests/{id}`. With window isolation each window is a
session: `list_sessions` shows them, and the other tools take `sessionId` (required
once more than one window is open).

_Tapline: Configure MCP Server…_ gives one-click install in Cursor, the URL, an
`mcp.json` snippet or a `claude mcp add` command.

## How it works

A Node agent drives a bundled, patched [sing-box](third_party/patches/sing-box/README.md):
sing-box terminates TLS with leaf certificates minted from the Tapline CA and streams
bodies through the agent, which records them, applies rules and passes them on.

## Development

Requires Node 24 LTS, Go 1.27+ and git.

```sh
git clone --recurse-submodules https://github.com/fqix/tapline.git && cd tapline
nvm use               # Node 24 LTS (.nvmrc)
npm ci
npm run core:build     # patch and build sing-box into core/<platform>-<arch>/
npm run build          # esbuild → dist/
npm test               # vitest: unit tests plus integration tests against the core
npm run test:e2e       # the extension inside a real VS Code (downloads it on first run)
npm run package        # VSIX for this platform (package:all for all six)
```

Press F5 to launch the extension development host. CI builds, tests and packages every
platform on each push and runs the end-to-end suite on one runner per OS.

## Releasing

CI never publishes. Add the version to [CHANGELOG.md](CHANGELOG.md), bump, push the tag
and publish a GitHub release:

```sh
npm version patch && git push --follow-tags
```

The [release workflow](.github/workflows/release.yml) rebuilds all platforms, publishes to
the VS Code Marketplace (Azure managed identity over OIDC, no PAT) and Open VSX, and
attaches the VSIX files to the release.

## Licence

MIT. The bundled sing-box core is GPL-3.0; its source revision, patches and notices ship
next to each binary.
