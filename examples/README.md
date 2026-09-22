# Tapline Traffic Examples

This directory provides sample HTTP client code in multiple programming languages (**Go**, **Python**, **TypeScript**, and **Java**), as well as a shell script to generate a broad spread of sample traffic through Tapline.

Each language example implements standard **GET**, **POST** (with JSON body), and **DELETE** requests without requiring any external 3rd-party dependencies.

---

## Running inside VS Code with Tapline

When you start traffic capture in the Tapline extension, VS Code terminals automatically have proxy environment variables (`HTTP_PROXY`, `HTTPS_PROXY`) and the custom CA certificate path (`SSL_CERT_FILE`) injected.

Running any of the examples below from such a terminal will route all requests directly through Tapline for inspection.

---

## 1. Go

Uses standard library `net/http` and `crypto/tls`.

```bash
# Run from repository root
go run -C examples/go .

# Or from the directory
cd examples/go
go run .
```

*Custom endpoint (optional):*
```bash
HTTPBIN=http://httpbin.org go run -C examples/go .
```

---

## 2. Python

Uses Python 3 standard library `urllib.request` (zero pip dependencies required).

```bash
python3 examples/python/main.py
```

*Custom endpoint (optional):*
```bash
HTTPBIN=http://httpbin.org python3 examples/python/main.py
```

---

## 3. TypeScript

Uses standard native `fetch` (Node.js 18+, Deno, Bun).

```bash
# Node.js 22+ with proxy support (Node requires --use-env-proxy or NODE_USE_ENV_PROXY=1 for native fetch)
NODE_USE_ENV_PROXY=1 node --experimental-strip-types examples/ts/main.ts

# Or with tsx
npx tsx examples/ts/main.ts

# Or install dependencies in examples/ts and run:
cd examples/ts && npm install && npm start
```

*Custom endpoint (optional):*
```bash
HTTPBIN=http://httpbin.org node --experimental-strip-types examples/ts/main.ts
```

---

## 4. Java

Uses Java 11+ standard `java.net.http.HttpClient` with zero Maven/Gradle external dependencies. Automatically reads `HTTP_PROXY` / `HTTPS_PROXY` and `SSL_CERT_FILE` from environment variables, or standard Java system properties (`-Dhttps.proxyHost=...`).

Supports Java single-file execution:

```bash
java examples/java/Main.java
```

*Custom endpoint (optional):*
```bash
HTTPBIN=http://httpbin.org java examples/java/Main.java
```

---

## 5. Shell Smoke Test

Generates a wide variety of HTTP/1.1, HTTP/2, HTTP/3 (QUIC), gRPC, and WebSocket traffic:

```bash
./examples/smoke-traffic.sh
```
