# Tapline inspection engine

Tapline is a VS Code extension with a shared Node agent and one sing-box core.
The agent owns capture policy, transaction storage and the IPC controller. The
core owns network transport; this module is the goproxy / quic-go inspection
engine it embeds. The engine originated in Tapline and retains its MIT license
(LICENSE); sing-box and dependencies retain their own licenses.

The engine is its own Go module (`github.com/fqix/tapline/engine`) and does not
import sing-box. The patched core adapts it in `service/taplineinspector` and
requires it through a `replace` directive to `../../engine`. The host supplies
two context hooks: `WithInboundControl` creates and removes window listeners, and
`WithInboundTag` names the inlet that accepted a connection.

## Configuration and ownership

`src/core/inspector.ts` generates `<agent-storage>/core-*/config.json`. The Node
agent launches `sing-box run -c <config>` with inherited stdin/stdout pipes and
`TAPLINE_HELPER_STDIN=1`, `TAPLINE_HELPER_PARENT=<agent-pid>`. These legacy-named
environment variables supervise the core; there is no privileged helper process.
The JSON declares the `tapline-inspector` service, the `tapline-inspect` outbound,
and UDP QUIC sniffing/routing. CA material and capture policy arrive over IPC.

The shared agent starts with no public inbounds. Each window receives a dynamic
`tapline-mixed` inlet bound to loopback. The configured port is preferred; a busy
port falls back to an OS-assigned port. Original client address and window inlet
identity travel over in-process memory streams, never trusted HTTP headers.
There is no private inspection TCP listener or token-authenticated CONNECT envelope.
`prepareInProcess` adapts routed streams for goproxy; QUIC uses routed packet metadata.

## Controller protocol

Frames on stdin/stdout are a four-byte big-endian length followed by UTF-8 JSON.
Binary values are encoded as `{ "$bytes": "base64" }`. stdout carries only IPC;
logs go to stderr. Only one inspector may own the control streams.

The controller sends `start` with `root` (certificate and private key), `host`,
`port` and `ingressPort`. The core responds with `ready`, including `in_process`,
`websocketSend` and `dynamicInbounds`. With dynamic inbounds, the initial port is
zero; `inbound-add`/`inbound-remove` carry `id`, window `session` and desired `port`.
`inbound-result` returns the assigned port or an error. Removing an inlet closes
its active connections before the controller drops its policy bindings.

Request callbacks (`connect`, `request`, `response`, `websocket`) carry a request
ID and source `socket` metadata, including the inbound window identity. The
controller returns inspection, request/response edits, local answers, or aborts.
Bodies use `<id>:<phase>:in|out` streams with `chunk`, `credit` and `end` frames.
Only one chunk per stream remains unacknowledged, providing bounded backpressure.
`abort` cancels the session; `failure` records transport errors; `closed` completes
lifecycle cleanup. Opaque tunnel completion ignores only local `io.ErrClosedPipe`
teardown races; network errors remain failures.

`websocket-send` carries a unique `id`, target `session`, `data` and `binary`.
`websocket-send-result` acknowledges the same ID with an optional error. Writes
are serialized with normal traffic; stalled sends close after five seconds.

HTTP/3 uses the same policy hooks. `quic` asks for `quic-result` with `inspect` and
`route`; excluded hosts remain encrypted. Optional `packet_egress` selects a core
outbound for native H3/encrypted UDP egress. Metadata uses HTTP version `3.0`.
Extended CONNECT/WebTransport and early-data acceptance are unsupported.

Upstream TLS verification is enabled by default. Per-request `options.insecure`
allows an untrusted **origin server** certificate for decrypted traffic. It never
disables certificate verification of an HTTPS chaining proxy. Opaque TLS bytes
remain unchanged; the application validates the original server certificate.

Control EOF/failure and SIGTERM close the service and its connections. There is
no concurrent reader of inspector stdin. SIGHUP reload is rejected; restart the
controller-owned process. Configuration via `-c stdin` and logging to stdout are
incompatible with IPC. Go embedders may provide exclusive control streams with
`WithControl(ctx, input, output, shutdown)`; closing the inspector closes them.

## Tests

The engine tests need no sing-box checkout:

```sh
cd engine && go test -race ./...
```

`npm run core:test` runs them again together with the patched sing-box packages.
