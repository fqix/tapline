# sing-box core for Tapline

Tapline's transport and inspection core is the upstream
[sing-box](https://github.com/SagerNet/sing-box) CLI at the revision pinned in
[pin.json](pin.json), built with the patch series in [patches/](patches/).
The patches originate from the [Fluxy](https://github.com/fqix/fluxy) desktop app
and are redistributed here under sing-box's GPL-3.0 licence together with the
MIT-licensed inspector engine they embed. They keep their original `fluxy-*`
protocol and service names; Tapline only generates configuration for them.

`scripts/build-core.mjs` clones the pinned tag into `.build/sing-box` (no git
submodule), applies the series with `git apply`, and compiles a static binary into
`core/<platform>-<arch>/sing-box[.exe]` together with a `.build.json` manifest and
the collected licence notices. Go 1.27+ must be on `PATH` (or `TAPLINE_GO`).

| Patch | Purpose |
| --- | --- |
| 0001 | `fluxy-mixed` inbound and `fluxy-inspect` outbound; shutdown on stdin EOF |
| 0002 | Reduced transport profile: TUN/HTTP/SOCKS/direct only, no VPN protocols |
| 0003 | Embedded `fluxy-inspector` service (goproxy engine, framed stdin/stdout IPC) |
| 0004 | Network manager startup race fix |
| 0005 | QUIC / HTTP/3 interception |
| 0006 | SOCKS5 UDP reply race fix |

The controller protocol the extension speaks is documented inside patch 0003 at
`service/fluxyinspector/README.md` and implemented in `src/core/inspector.ts`.
