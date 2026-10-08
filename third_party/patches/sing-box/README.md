# sing-box core for Tapline

Tapline uses the upstream [sing-box](https://github.com/SagerNet/sing-box) CLI at
[pin.json](pin.json), with two patches applied in [series](series) order. it retains its
MIT license inside the GPL-3.0 sing-box distribution. Tapline uses a VS Code
extension, one shared Node agent and one core, with an isolated inlet per window.

| Patch                     | Purpose                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001-tapline-core.patch   | Reduced transport profile; the glue that embeds the [inspection engine](../../../engine/README.md) (service, outbound, window inlets, IPC ownership, registry); JA3 and QUIC sniffing hooks; SOCKS5 SNI certificate selection |
| 0002-socks-udp-race.patch | Bind SOCKS5 UDP reply endpoints before concurrent routing; preserve and test the wrapper chain                                                                                                                                |

One patch per concern: the glue files Tapline introduces in sing-box live in the
first patch, so a fix to them is folded in rather than stacked on top of it. The
capture engine itself (HTTP/1–3, gRPC and WebSocket capture, TLS policy and tunnel
lifecycle, HTTP/2 header filtering, IPC) is not part of the series. It is the separate
Go module in [engine](../../../engine), which the patch requires with
`replace github.com/fqix/tapline/engine => ../../engine`, so engine changes need no
patch export. The second patch stays separate because it changes
upstream networking independently of the inspector, which keeps it droppable when
upstream lands its own fix and sendable upstream as it is (former patch 0002 for
network manager startup race was dropped when upstream landed lifecycle synchronization).
Obsolete token-based inspection ingress and its tests are removed from the resulting tree.

Rebuild the first patch after changing the glue in sing-box: apply the series
to a pristine checkout of `pin.json`'s revision, commit the result, and export it
with `git format-patch`. `npm run core:build` then verifies it applies cleanly.

## TLS semantics

Origin certificates are verified by default. The per-request `insecure` option
accepts untrusted origin certificates only for decrypted traffic; HTTPS chaining
proxies still require valid certificates. Excluded hosts are opaque tunnels and
keep the original server certificate and application certificate validation.

Opaque tunnel completion ignores only `io.ErrClosedPipe` from local memory-pipe
teardown after the client has consumed its response. `net.ErrClosed` and other
transport errors remain failures. These semantics consolidate former patches
0010 (upstream trust policy) and 0011 (tunnel closure).

The controller protocol and current architecture are documented in
[engine/README.md](../../../engine/README.md), with the controller implemented
in `src/core/inspector.ts`. `TAPLINE_HELPER_*` are legacy-named process-supervision
environment variables, not a separate helper process.

## Build and validate

Populate [../../sing-box](../../sing-box) with
`git submodule update --init --recursive`. `scripts/build-core.mjs` verifies the
pinned revision, applies patches with plain `git apply`, and builds
`core/<platform>-<arch>/sing-box[.exe]`, its `.build.json` manifest and license
notices. The build toolchain is `go1.27.1` in `pin.json` (`TAPLINE_GO` may select
the executable). The upstream `go.mod` directive `go 1.25.5` declares its
language/module compatibility minimum, not the pinned build toolchain version.

`npm run core:test` runs race-enabled tests and vet for the include, CLI, JA3 parser
and SOCKS packages (every patched test package) and for the engine module, which
also tests standalone with `cd engine && go test -race ./...`. Build
scripts reset the submodule: commit or save local submodule edits first.

## Patched dependencies and security ownership

The engine module ([engine/go.mod](../../../engine/go.mod)) adds these pinned modules to
the upstream module graph:

| Module                       | Version  | Role                                     |
| ---------------------------- | -------- | ---------------------------------------- |
| `github.com/elazarl/goproxy` | `v1.9.1` | HTTP proxy and HTTPS interception engine |
| `github.com/gobwas/ws`       | `v1.4.0` | WebSocket framing and handshake          |

Tapline maintainers own their security review and updates separately from the
upstream sing-box pin. npm audit and manifest-only dependency bots do not inspect
module requirements inside patch text. `core:test` scans the patched inspector
source and the engine with `govulncheck v1.8.0`, so reachable advisories fail CI.
Review new advisories and releases when changing the pin or the engine's
dependencies. The patched `go.mod` and `go.sum` must list the same versions as
`engine/go.mod`: update via `go get` in the engine, mirror the change in the isolated
source branch, retain Go-generated go.mod/go.sum ordering, and re-export the core
patch. The engine's `quic-go` and `x/net` pins follow the sing-box pin. The bundled core manifest records compiled module
versions and license notices for auditing shipped artifacts.

## Updating the series

Patches are exported from real Git commits using
`git format-patch --full-index --binary`; every file diff retains full blob hashes.
Use an isolated clone at the pinned revision, apply the series with `git am`, and
keep the three logical commits when updating. On an upstream update,
`git am --3way` can use the recorded preimages when their objects are available
(fetch the previous pinned revision if necessary). Resolve and test conflicts
explicitly, then export the series again and update the pin and manifest hashes.
Normal builds deliberately use plain `git apply`: they must reproduce a reviewed
source tree, not silently merge against a different upstream revision.
