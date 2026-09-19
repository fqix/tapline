# Changelog

All notable changes to Tapline are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.5.0]

### Added

- Compare replays with their original request from the inspector or row menu.
- Add session notes and star markers shared across VS Code windows.
- Copy retained response bodies from the inspector or row menu (Base64 for binary).
- Compare two captured requests in the native VS Code diff editor, with stable snapshots
  of request/response headers and bodies, formatted JSON, Base64 binary content and trailers.

## [0.4.0]

### Added

- Stream message tools for WebSocket, SSE and gRPC: search, per-message copy,
  pause display while capture continues, and follow latest. WebSocket adds direction
  filtering and resending complete outgoing messages on the original open connection,
  including binary payloads. gRPC messages appear before the stream finishes.
- Interception rules (`tapline.rules`, with an editor in the traffic panel): breakpoints
  hold a request or response so it can be edited before it continues, rewrite changes
  method / URL / status / headers / body, map local answers with a file or inline body,
  map remote sends the request to another origin, block refuses it, throttle adds
  latency and caps bandwidth. _Break on This URL_ adds a breakpoint from a request.
- Compose pane to send a request from scratch, and _Edit & Resend_ on a captured one.
- Filter query language (`status:5xx method:post host:api.* type:json size>10k dur>500
body:"…" header:name=value -term`, with a syntax popover), multi-select in the table
  (Cmd/Ctrl-click, Shift-click, Cmd/Ctrl+A) with copy-as-cURL / export HAR / delete for
  the selection, and a Statistics pane (per host, slowest and largest responses).
- Inspector: gzip / deflate / br / zstd response bodies are decoded; Pretty view for
  XML and HTML, inline image preview, multipart/form-data fields, decoded JWTs with
  expiry, and find-in-body with match navigation.
- End-to-end test suite (`npm run test:e2e`) that runs the extension in a real VS Code,
  wired into CI on macOS, Linux and Windows.
- The text document, MCP listings and `get_request` report applied rules, local
  responses, the upstream URL and paused state.

### Changed

- Interface typography now matches the VS Code workbench; body code retains the editor font.
- Bundle Wintun 0.14.1 for Windows capture.

### Fixed

- Resume and abort paused requests using the correct transaction identifier.

## [0.3.0]

### Added

- MCP endpoint served by the capture agent at `http://127.0.0.1:3607/mcp` (Streamable
  HTTP, `tapline.mcp.enabled` / `tapline.mcp.port`) exposing captured traffic to AI
  assistants: `status`, `list_requests`, `search`, `get_request`, `get_body`, `replay`,
  `send`, `export_har`, `start_capture`, `stop_capture`, `set_recording`, `clear`,
  `delete` and `tapline://requests/{id}` resources.
- _Tapline: Configure MCP Server…_ offers Cursor one-click install, the URL, an
  `mcp.json` snippet and a `claude mcp add` command.
- gRPC decoding: request and response bodies are split into their length-prefixed
  messages (gzip/deflate and gRPC-Web trailers handled) and decoded with the workspace's
  `.proto` files (`tapline.grpc.protoFiles`, watched for changes) or by field number when
  no schema matches. The inspector gets a _Messages_ body view, `grpc-status` colours the
  status dot and appears in Overview and the tree, the method column reads _gRPC_, and
  the text document and MCP `get_request` include the decoded messages.
- Sequence table: a `#` column with the capture sequence number, and draggable column
  widths (double-click a handle to reset); widths are remembered.

### Changed

- The traffic panel follows the VS Code font family, size and weight instead of
  hard-coded 11–12px text; code-like values use the editor font.
- Clearing the session restarts sequence numbers at 1.
- A window running a newer build replaces the shared capture agent automatically
  (restoring capture if it was running), so updates and rebuilds take effect without
  closing every window.

## [0.2.0]

### Changed

- One **Tapline** panel replaces the separate request, host and sequence views. The
  sidebar _Structure_ tree stays: clicking a request focuses it in the panel, clicking a
  host filters the panel to that host and shows its overview.
- The sequence table is virtualised and receives rows incrementally, so thousands of
  requests scroll and filter without stalling. Host summaries are computed from table rows
  instead of shipping full bodies to the webview.
- The inspector uses Overview, Request and Response tabs (plus Frames and SSE Events).
  Request and Response are single scrolling pages of collapsible Headers, Query, Cookies,
  Set-Cookie, Form, Trailers and Body sections.
- The panel is styled with VS Code theme variables and codicons and follows light, dark
  and high-contrast themes.

### Added

- Quick status chips (2xx / 3xx / 4xx / 5xx / pending / errors), a host chip, a
  CONNECT-tunnel toggle and `Cmd/Ctrl+F` to focus the filter.
- Inspector below or beside the table, switchable from the toolbar and remembered.
- Body viewer with Pretty JSON (syntax coloured), Text and Hex modes.
- Response trailers (gRPC status and friends) are shown.
- Keyboard navigation: ↑/↓ select, Enter opens as text, Esc clears the selection or
  filters, Delete (Cmd/Ctrl+Backspace) removes the selected request.
- "Show original" link from a replayed request to the request it replayed.

## [0.1.0]

### Added

- Capture HTTP, HTTPS, HTTP/2, HTTP/3, gRPC, WebSocket and SSE traffic through a bundled,
  patched sing-box core shared by all VS Code windows.
- Charles-style _Structure_ tree, _Sequence_ table and a detail panel with overview,
  timing waterfall, request and response contents, WebSocket frames and SSE events.
- Automatic injection of proxy and CA variables into new terminals and debug sessions,
  with per-runtime profiles (openssl, git, node, python, java, rust, deno, grpc).
- Root certificate install, trust and uninstall in the OS store on macOS, Windows and
  Linux; capture waits until the CA is trusted.
- Copy as cURL, copy URL, export HAR, replay, status-bar controls, English and
  Simplified Chinese UI.
- Platform-specific VSIX packages for macOS, Linux and Windows on x64 and arm64.
