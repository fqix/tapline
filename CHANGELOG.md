# Changelog

All notable changes to Tapline are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.12.3]

### Fixed

- Avoid reporting normal WebSocket socket cleanup as a connection error.
- Show WS/WSS in the Protocol column and publish the upstream server address as
  soon as the WebSocket handshake completes.
- Keep WebSocket smoke checks working with closed stdin and enforce a 30-second
  overall deadline, including connection setup.

### Added

- Real WebSocket echo smoke checks for httpbingo.org and echo.websocket.org,
  accepting welcome messages while still requiring an exact echo.
- WSS regression coverage for idle connections, message replay, upstream addresses
  and normal closure.

## [0.12.2]

### Fixed

- SOCKS5 HTTPS connections with client-side DNS resolution now use TLS SNI to select
  the interception certificate, avoiding hostname mismatches for domain requests.
- Filter HTTP/1 connection-specific response headers before forwarding to HTTP/2
  clients, preventing strict clients from rejecting captured HTTPS responses.
- Password fields (the composer's Basic auth) were drawn with the browser's default
  white box instead of the editor's input styling.
- Collapsing one JWT section collapsed every other JWT on the same side; each token now
  keeps its own state.

### Changed

- Copy Proxy Environment now produces one line containing only `https_proxy`,
  `http_proxy` and `all_proxy`, with SOCKS5 support and shell-specific quoting.
- The composer's Authorization tab puts its labels beside the fields instead of above
  them, sizes the type dropdown to its content, adds a show/hide toggle for the Basic
  auth password, and shows the `Authorization` header the request will send.
- A decoded JWT shows whether it is valid, not yet valid or expired (with how long ago
  or from now), lists its registered claims — issuer, subject, audience and the `iat` /
  `nbf` / `exp` times as local timestamps — and renders the header and the payload as
  labelled JSON trees instead of two unlabelled blocks. The token and the decoded JSON
  each have a copy button, and the signature is marked as unverified.

### Added

- SOCKS5 HTTP/HTTPS capture regression tests and real-site E2E coverage for both
  `socks5` and `socks5h`, including upstream certificate validation.

## [0.12.1]

### Changed

- Enable acceptance of any upstream certificate by default for decrypted connections;
  an explicit disabled setting still enforces certificate validation.

### Fixed

- Allow native text selection copying and context menus throughout traffic webviews.

## [0.12.0]

### Added

- Settings buttons to set VS Code's user proxy to the live capture port or remove
  the user proxy override, with capture-state feedback and unchanged TLS validation.
- An Undecrypted label for opaque CONNECT tunnels in the request list.
- `tapline.port` setting for the capture proxy port (default 3606). A busy port falls
  back to a free OS-assigned one; set it to 0 to always ask the OS for a free port.
- `tapline.ssl.noHosts` and `!`-prefixed patterns in `tapline.ssl.hosts` to exclude
  hosts from HTTPS decryption; excluded hosts are tunnelled opaquely.
- `tapline.ssl.noProxy` to append hostnames to NO_PROXY/no_proxy in captured
  terminals and debug sessions, on top of the host's own NO_PROXY.
- `tapline.ssl.insecureUpstream` to accept any upstream certificate on decrypted
  connections, for self-signed or expired development backends. Off by default: the
  client only ever sees the Tapline certificate, so upstream interception would
  otherwise go unnoticed.

### Changed

- Simplify the sidebar toolbar to Start/Stop, Clear, Traffic Panel and Settings;
  move less frequent actions into the overflow menu.
- Consolidate the sing-box patch series and scan the patched Go dependencies in CI.
- TLS decryption follows host inclusion/exclusion settings, keeping
  `tapline.ssl.hosts` at `["*"]` by default (unlike Charles's opt-in default).
  Excluded hosts keep their original TLS connection, including certificate pinning.
  There is no extra TLS probe or automatic retry/fallback after a handshake failure.

### Fixed

- Restore the previous VS Code user proxy when capture stops or the extension exits,
  follow live port changes, and display workspace proxy overrides explicitly.
- Preserve public CA trust for partially decrypted terminal and debug traffic with
  a combined PEM trust bundle.
- Keep shared capture alive when a window disconnects with unread IPC replies.
- Avoid marking completed passthrough tunnels as failed when the client closes
  before trailing TLS bytes reach the internal pipe.

## [0.11.0]

### Added

- Right-click context menu on traffic table rows with native commands: Replay,
  Compose (Edit & Resend), Open as Text, Copy (cURL, URL, response body), Compare,
  Toggle Mark, Edit Note, Add Breakpoint and Delete.
- Protocol version column in the sequence table and inspector badges displaying
  HTTP/1.1, HTTP/2.0 and HTTP/3.0. Supports sorting by protocol and query filters
  such as `proto:h2`, `version:2.0`, `http/1.1`.
- Quick filters on the toolbar for JSON, JS (JavaScript/TypeScript), HTML (web pages,
  excluding 4xx/5xx error templates and 3xx redirects) and WS (WebSocket connections).
- Multi-language HTTP client example suite in `examples/` for Go, Python, TypeScript
  and Java demonstrating GET, POST and DELETE with zero external dependencies and
  proxy environment support.

### Changed

- Replaced table row hover action buttons with the native context menu, freeing up
  horizontal space and improving table legibility.
- Increased default column widths for Method (82px) and Protocol (96px) to avoid
  text truncation on longer methods and HTTP version labels with sort indicators.
- Reorganized `src/` directory into modular subdirectories (`agent/`, `core/`,
  `extension/`, `shared/`, `utils/`, `webview/`, `test/`).

### Fixed

- Upgrading the extension starts and checks the new capture agent before stopping
  the previous version; startup failures keep the previous agent and traffic intact.
  Same-version and newer agents remain shared across windows to prevent restart loops.
- Full URL queries (e.g. `http://example.com/api`) in the search bar are no longer
  mistakenly parsed as protocol version filters.
- Preserved sidebar tree view multi-selection and folder/host deletion in the
  `tapline.delete` command.
- Fixed container query column definitions in narrow panes (≤760px) to prevent
  grid track misalignment and overflow.

## [0.10.0]

### Added

- Import cURL commands with curlconverter's WebAssembly parser, including multiline
  commands, UTF-8 data files, authentication, cookies and query data. Import warnings
  identify missing files, multipart file references and unsupported transport options.
- Selectable query parameters and headers, Basic/Bearer/custom authorization, and six
  composer body modes: none, form-data, x-www-form-urlencoded, raw, binary and GraphQL.
- Multipart text/file fields, binary file uploads, URL-encoded form descriptions and
  bulk editing, plus GraphQL query, variables and operation name fields.
- Debug and run sessions print the injected proxy and certificate environment
  variables to their debug console.
- Regression coverage for all 48 ReqBin cURL example entries, with documented import
  limitations and additional body serialization tests.

### Changed

- The request editor groups Params, Authorization, Headers and Body into tabs with
  content indicators. The request bar includes the method, URL and Send shortcut;
  raw JSON supports validation and formatting.
- Terminal environment settings preview resolved variables and explain each profile.
  Debug sessions use the built-in variable set for their configuration type.

### Fixed

- Import pasted multiline cURL commands and resolve data-file bodies; preserve explicit
  User-Agent removal and warn about unresolved multipart files.
- Linux ARM64 builds on Node 24 skip unused native parser installation; tests transform
  curlconverter through the same WASM parser replacement used by the extension build.

### Removed

- Shared capture mode and `tapline.isolateWindows`: each window now has its own capture
  session and an OS-assigned proxy port.
- `tapline.port`, `tapline.ssl.enabled`, `tapline.terminal.inject`,
  `tapline.debug.inject` and `tapline.debug.runtimes`. Ports are assigned automatically;
  HTTPS decryption and terminal/debug injection are enabled by default. Set
  `tapline.ssl.hosts` to `[]` to capture without decryption or a trusted certificate.
  `tapline.terminal.profiles` still controls terminal variable profiles.

## [0.9.0]

### Added

- _Tapline: Settings_ (also the gear icon in the traffic panel) opens global
  preferences in their own editor tab, with category navigation and bilingual
  (English/简体中文) search across setting names and descriptions.

### Changed

- Window isolation: by default each VS Code window gets its own capture data,
  controls and OS-assigned proxy port, while windows in the same extension storage
  environment still share one sing-box process and root CA. Closing a window removes
  its inlet and connections after a 3-second reconnect grace period; the last window
  shuts down the agent and core. Disable the new `tapline.isolateWindows` setting and
  reload to go back to a single shared capture session. Notes and markers now belong
  to the capture session instead of being shared globally across windows.
- Settings and rules are saved in VS Code extension global storage instead of
  `settings.json`, shared across projects in the same VS Code profile; existing
  explicit global settings are migrated once, and workspace-level settings are no
  longer used.
- MCP keeps one fixed shared endpoint; `list_sessions` lists the active windows, and
  all other MCP tools accept an optional `sessionId` (required once more than one
  window is active).

### Fixed

- The Settings panel's Close, Save and Clear buttons use the app's own button styling
  instead of the browser's default button appearance.

## [0.8.0]

### Added

- _Server IP_ column in the sequence table (also in the overview, the `ip:` filter
  term and HAR `serverIPAddress`): the upstream `ip:port` the response came from,
  reported by the core (patch 0008), or the tunnel target for CONNECT.
- Header, query, cookie and form rows can be selected and copied natively and carry a
  hover button that copies the single `name: value` line.

### Changed

- The sequence table shows one _URL_ column (scheme, host and path, with the TLS lock
  in the icon slot) instead of separate Host and Path columns; remembered column widths
  for the old columns are dropped.
- The inspector shows the request and the response side by side (stacked when the
  panel is narrow), each with its own tab strip: Overview / Raw / Params / Headers /
  Body for the request, Raw / Headers / Body (plus Frames and SSE Events) for the
  response, with method, protocol and status badges. The new _Raw_ tab renders the
  message as sent, with line numbers, coloured headers and pretty-printed JSON (Text
  shows it byte for byte). A button in the inspector header switches back to the
  single tab strip; the choice and the divider position are remembered.
- Cut, copy and paste (shortcuts, context menu and drops) are blocked inside the panel
  except in the name/value tables; the panel's own copy buttons are unaffected.

### Fixed

- Resizing columns to the right of the URL column moved the wrong boundary; the
  handle now sits on those columns' left edge and follows the pointer.
- `scripts/build-core.mjs` resets the submodule index before re-applying the patch
  series, so staged files no longer break the build.

## [0.7.0]

### Added

- Show request and response JSON as a collapsible field/value tree, with array
  indexes, child counts, and expand-all / collapse-all controls.
- Confirm single and bulk deletion of captured requests.

### Fixed

- Avoid extension-host startup crashes caused by automatically injecting
  `NODE_EXTRA_CA_CERTS`; retain extra CA trust for regular Node.js debugging.
- Render toolbar tooltips inside the webview, supporting hover and keyboard focus.

### Changed

- Show a text cURL button in the inspector and notifications after successful copies.
- Remove the redundant copy-URL inspector action and Show Traffic startup button.

## [0.6.1]

### Fixed

- Inject proxy and certificate environment variables into VS Code extension debugging
  sessions (`extensionHost` and `pwa-extensionHost`). Start capture before launching
  or restarting the debug session for the environment to take effect.

## [0.6.0]

### Added

- Copy proxy and certificate environment commands for Bash/Zsh, Fish, Nushell,
  CMD and PowerShell from the capture toolbar or startup notification, remembering
  the selected shell.
- Recorded setup and inspection walkthrough covering root certificate installation,
  HTTP requests, edit/resend, request diffs and schema-decoded gRPC fields.

### Fixed

- Prepare the root certificate identity before checking system trust.
- Recover from capture startup failures and bound agent handshake waits.
- Reuse compatible agent builds without restarting an active capture.
- Open request comparisons in the active editor group.
- Display stream message timestamps in local time.

### Changed

- Use Node.js 24 LTS for development and CI, and Azure Login v3 for publishing.

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
