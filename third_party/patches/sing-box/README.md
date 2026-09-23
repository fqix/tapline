# sing-box core for Tapline

Tapline uses the upstream [sing-box](https://github.com/SagerNet/sing-box) CLI at
[pin.json](pin.json), with three patches applied in [series](series) order. The
capture engine originated in [Fluxy](https://github.com/fqix/fluxy); it retains its
MIT license inside the GPL-3.0 sing-box distribution. Tapline uses a VS Code
extension, one shared Node agent and one core, with an isolated inlet per window.

| Patch | Purpose |
| --- | --- |
| 0001-tapline-core.patch | Reduced transport profile; embedded inspector; HTTP/1–3, gRPC and WebSocket capture; IPC; dynamic window inlets; TLS policy and tunnel lifecycle |
| 0002-network-startup-race.patch | Atomic network manager startup state |
| 0003-socks-udp-race.patch | Bind SOCKS5 UDP reply endpoints before concurrent routing; preserve and test the wrapper chain |

The first patch consolidates the former 0001–0003, 0005, and 0007–0011 patches.
The other two retain the former 0004 and 0006 fixes separately because they affect
upstream networking independently of Tapline's inspector. Obsolete token-based
inspection ingress and its tests are removed from the resulting tree.

## TLS semantics

Origin certificates are verified by default. The per-request `insecure` option
accepts untrusted origin certificates only for decrypted traffic; HTTPS chaining
proxies still require valid certificates. Excluded hosts are opaque tunnels and
keep the original server certificate and application certificate validation.

Opaque tunnel completion ignores only `io.ErrClosedPipe` from local memory-pipe
teardown after the client has consumed its response. `net.ErrClosed` and other
transport errors remain failures. These semantics consolidate former patches
0010 (upstream trust policy) and 0011 (tunnel closure).

The controller protocol and current architecture are documented in the patched
`service/taplineinspector/README.md` (inside 0001), with the controller implemented
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

`npm run core:test` runs race-enabled tests and vet for the inspector, include,
CLI, JA3 parser and SOCKS packages, covering every patched test package. Build
scripts reset the submodule: commit or save local submodule edits first.

## Patched dependencies and security ownership

The core integration adds these pinned modules to the upstream module graph:

| Module | Version | Role |
| --- | --- | --- |
| `github.com/elazarl/goproxy` | `v1.9.1` | HTTP proxy and HTTPS interception engine |
| `github.com/gobwas/ws` | `v1.4.0` | WebSocket framing and handshake |

Tapline maintainers own their security review and updates separately from the
upstream sing-box pin. npm audit and manifest-only dependency bots do not inspect
module requirements inside patch text. `core:test` scans the patched inspector
source with `govulncheck v1.8.0`, so reachable advisories fail CI. Review new
advisories and releases when changing the pin or patch series; update via `go get`
in the isolated source branch, retain Go-generated go.mod/go.sum ordering, and
re-export the core patch. The bundled core manifest records compiled module
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
