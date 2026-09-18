# Changelog

All notable changes to Tapline are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-09-18

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

## [0.1.0] - 2026-09-18

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
