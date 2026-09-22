#!/usr/bin/env bash
# Generate a spread of traffic through the Tapline proxy so every panel feature has
# something to show: plain HTTP, HTTPS, HTTP/2, redirects, each status class, JSON /
# form / binary / gzip bodies, cookies, chunked streams and gRPC (unary, server, client and
# bidirectional streams, plaintext and TLS) and HTTP/3 over QUIC.
#
# Run it from a VS Code terminal opened while capture is on — Tapline injects
# HTTP(S)_PROXY and the CA variables there. Elsewhere, set them by hand:
#   HTTPS_PROXY=http://127.0.0.1:3606 SSL_CERT_FILE=/path/to/tapline-ca.pem examples/smoke-traffic.sh
#
# Needs curl; the gRPC part needs grpcurl (brew install grpcurl) and is skipped otherwise.
set -u

HTTPBIN=${HTTPBIN:-https://httpbin.org}
HTTPBIN_PLAIN=${HTTPBIN_PLAIN:-http://httpbin.org}
GRPCBIN_TLS=${GRPCBIN_TLS:-grpcb.in:9001}
GRPCBIN_PLAIN=${GRPCBIN_PLAIN:-grpcb.in:9000}
PAUSE=${PAUSE:-0.2}
# Directory holding this script (also when run through a symlink, `bash script`
# from elsewhere, or piped from stdin — then fall back to the git checkout).
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd -P)
if [[ ! -d $script_dir/h3-probe ]]; then
    script_dir=$(git rev-parse --show-toplevel 2>/dev/null)/examples
fi
H3_PROBE=${H3_PROBE:-$script_dir/h3-probe}

if [[ -z ${HTTPS_PROXY:-${https_proxy:-}} ]]; then
    echo "warning: HTTPS_PROXY is not set — traffic will bypass Tapline" >&2
fi

pass=0
fail=0
step() {
    # step <label> <curl args…>: prints the status code and keeps a tally.
    local label=$1
    shift
    local code
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$@" 2>&1)
    if [[ $code =~ ^[0-9]{3}$ ]]; then
        printf '  %-42s %s\n' "$label" "$code"
        ((pass++))
    else
        printf '  %-42s FAIL %s\n' "$label" "$code"
        ((fail++))
    fi
    sleep "$PAUSE"
}

echo "== Plain HTTP"
step "GET  /get"                      "$HTTPBIN_PLAIN/get?source=tapline&n=1"
step "POST /post (json)"              -H 'Content-Type: application/json' -d '{"hello":"tapline","n":1}' "$HTTPBIN_PLAIN/post"

echo "== HTTPS / HTTP/2"
step "GET  /get (http/1.1)"           --http1.1 "$HTTPBIN/get?proto=h1"
step "GET  /get (http/2)"             --http2 "$HTTPBIN/get?proto=h2"
step "GET  /headers"                  -H 'X-Tapline: smoke' -H 'Accept: application/json' "$HTTPBIN/headers"
step "GET  /user-agent"               -A 'tapline-smoke/1.0' "$HTTPBIN/user-agent"

echo "== Methods and bodies"
step "POST /post (form)"              -d 'name=tapline&lang=zh-cn' "$HTTPBIN/post"
step "POST /post (multipart)"         -F 'field=value' -F 'file=@/etc/hosts;filename=hosts.txt' "$HTTPBIN/post"
step "PUT  /put (json)"               -X PUT -H 'Content-Type: application/json' -d '{"id":42,"tags":["a","b"],"nested":{"ok":true,"none":null}}' "$HTTPBIN/put"
step "PATCH /patch"                   -X PATCH -H 'Content-Type: application/json' -d '{"op":"replace"}' "$HTTPBIN/patch"
step "DELETE /delete"                 -X DELETE "$HTTPBIN/delete?id=42"
step "HEAD /get"                      -I "$HTTPBIN/get"
step "OPTIONS /get"                   -X OPTIONS "$HTTPBIN/get"

echo "== Status classes"
step "GET  /status/201"               "$HTTPBIN/status/201"
step "GET  /status/204"               "$HTTPBIN/status/204"
step "GET  /status/301 (no follow)"   "$HTTPBIN/status/301"
step "GET  /redirect/3 (followed)"    -L "$HTTPBIN/redirect/3"
step "GET  /status/400"               "$HTTPBIN/status/400"
step "GET  /status/401"               "$HTTPBIN/status/401"
step "GET  /status/404"               "$HTTPBIN/status/404"
step "GET  /status/429"               "$HTTPBIN/status/429"
step "GET  /status/500"               "$HTTPBIN/status/500"
step "GET  /status/503"               "$HTTPBIN/status/503"

echo "== Response encodings and content types"
step "GET  /json"                     "$HTTPBIN/json"
step "GET  /xml"                      "$HTTPBIN/xml"
step "GET  /html"                     "$HTTPBIN/html"
step "GET  /js (httpbin)"             "$HTTPBIN_PLAIN/response-headers?Content-Type=application/javascript"
step "GET  /js (cdn)"                 "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"
step "GET  /gzip"                     --compressed "$HTTPBIN/gzip"
step "GET  /brotli (undecoded)"       "$HTTPBIN/brotli"
step "GET  /image/png (binary)"       "$HTTPBIN/image/png"
step "GET  /image/jpeg (binary)"      "$HTTPBIN/image/jpeg"
step "GET  /bytes/2048 (random)"      "$HTTPBIN/bytes/2048"
step "GET  /base64"                   "$HTTPBIN/base64/VGFwbGluZSBzbW9rZSB0ZXN0"

echo "== Cookies, auth, cache"
step "GET  /cookies/set"              -L -c /dev/null "$HTTPBIN/cookies/set?session=abc123&theme=dark"
step "GET  /cookies (sent)"           -b 'session=abc123; theme=dark' "$HTTPBIN/cookies"
step "GET  /basic-auth"               -u 'user:passwd' "$HTTPBIN/basic-auth/user/passwd"
step "GET  /bearer"                   -H 'Authorization: Bearer tapline-token' "$HTTPBIN/bearer"
step "GET  /cache (304)"              -H 'If-None-Match: "any"' "$HTTPBIN/cache"
step "GET  /etag"                     "$HTTPBIN/etag/tapline-etag"
step "GET  /response-headers"         "$HTTPBIN/response-headers?X-Custom=1&Content-Type=text/plain"

echo "== Timing and streams"
step "GET  /delay/2"                  "$HTTPBIN/delay/2"
step "GET  /stream/5 (chunked json)"  "$HTTPBIN/stream/5"
step "GET  /drip (slow body)"         "$HTTPBIN/drip?duration=2&numbytes=20&code=200"
step "GET  /stream-bytes/4096"        "$HTTPBIN/stream-bytes/4096?chunk_size=512"
step "GET  /range/1024 (partial)"     -r 0-255 "$HTTPBIN/range/1024"

echo "== gRPC ($GRPCBIN_TLS / $GRPCBIN_PLAIN)"
if command -v grpcurl >/dev/null 2>&1; then
    # Go honours HTTPS_PROXY, so grpcurl goes through the proxy like curl does. The
    # Tapline CA is injected as SSL_CERT_FILE; pass it explicitly for platforms
    # where Go ignores that variable.
    ca=()
    [[ -n ${SSL_CERT_FILE:-} && -f ${SSL_CERT_FILE:-} ]] && ca=(-cacert "$SSL_CERT_FILE")
    gstep() {
        # gstep <label> <grpcurl args…>
        local label=$1
        shift
        if grpcurl -max-time 30 "$@" >/dev/null 2>&1; then
            printf '  %-42s ok\n' "$label"
            ((pass++))
        else
            printf '  %-42s FAIL\n' "$label"
            ((fail++))
        fi
        sleep "$PAUSE"
    }
    gstep "plain  hello.HelloService/SayHello"  -plaintext -d '{"greeting":"tapline"}' "$GRPCBIN_PLAIN" hello.HelloService/SayHello
    gstep "tls    hello.HelloService/SayHello"  "${ca[@]}" -d '{"greeting":"tapline"}' "$GRPCBIN_TLS" hello.HelloService/SayHello
    gstep "tls    addsvc.Add/Sum"               "${ca[@]}" -d '{"a":2,"b":40}' "$GRPCBIN_TLS" addsvc.Add/Sum
    gstep "tls    addsvc.Add/Concat"            "${ca[@]}" -d '{"a":"tap","b":"line"}' "$GRPCBIN_TLS" addsvc.Add/Concat
    gstep "tls    grpcbin.GRPCBin/Index"        "${ca[@]}" "$GRPCBIN_TLS" grpcbin.GRPCBin/Index
    gstep "tls    grpcbin.GRPCBin/DummyUnary"   "${ca[@]}" -d '{"f_string":"x","f_int32":7,"f_strings":["a","b"]}' "$GRPCBIN_TLS" grpcbin.GRPCBin/DummyUnary
    gstep "tls    GRPCBin/HeadersUnary"         "${ca[@]}" -H 'x-tapline: smoke' "$GRPCBIN_TLS" grpcbin.GRPCBin/HeadersUnary
    gstep "tls    GRPCBin/Empty"                "${ca[@]}" "$GRPCBIN_TLS" grpcbin.GRPCBin/Empty
    gstep "tls    reflection list"              "${ca[@]}" "$GRPCBIN_TLS" list
    # Calls that end with a non-OK grpc-status on purpose, to see status handling.
    gerr() {
        # gerr <label> <grpcurl args…>: expects the call to fail.
        local label=$1
        shift
        grpcurl -max-time 30 "$@" >/dev/null 2>&1
        printf '  %-42s grpc-status varies\n' "$label"
        sleep "$PAUSE"
    }
    gerr "tls    GRPCBin/SpecificError"          "${ca[@]}" -d '{"code":5,"reason":"not found"}' "$GRPCBIN_TLS" grpcbin.GRPCBin/SpecificError

    echo "== gRPC streams"
    # Server stream: one request, ten messages back (DummyServerStream repeats it 10x).
    gstep "tls    server stream (10 msgs)"       "${ca[@]}" -d '{"f_string":"server-stream","f_int32":1,"f_strings":["a","b"]}' "$GRPCBIN_TLS" grpcbin.GRPCBin/DummyServerStream
    gstep "plain  server stream (10 msgs)"       -plaintext -d '{"f_string":"server-stream-plain"}' "$GRPCBIN_PLAIN" grpcbin.GRPCBin/DummyServerStream
    # Bidirectional: each request message is echoed back, so N in → N out.
    gstep "tls    bidi stream (5 msgs)"          "${ca[@]}" -d '{"f_string":"m1"} {"f_string":"m2","f_int32":2} {"f_string":"m3","f_bool":true} {"f_string":"m4","f_strings":["x","y"]} {"f_string":"m5","f_bytes":"dGFwbGluZQ=="}' "$GRPCBIN_TLS" grpcbin.GRPCBin/DummyBidirectionalStreamStream
    gstep "plain  bidi stream (3 msgs)"          -plaintext -d '{"f_string":"p1"} {"f_string":"p2"} {"f_string":"p3"}' "$GRPCBIN_PLAIN" grpcbin.GRPCBin/DummyBidirectionalStreamStream
    # Client stream: three messages up, one reply. grpcb.in currently answers this with
    # an Internal error (nil marshal on its side), so the stream is captured but ends
    # with a non-OK status.
    gerr "tls    client stream (3 msgs, srv bug)" "${ca[@]}" -d '{"f_string":"c1"} {"f_string":"c2"} {"f_string":"c3"}' "$GRPCBIN_TLS" grpcbin.GRPCBin/DummyClientStream
    # RandomError fails about half the time: a few calls mix OK and non-OK entries.
    for i in 1 2 3 4; do
        gerr "tls    GRPCBin/RandomError #$i"       "${ca[@]}" "$GRPCBIN_TLS" grpcbin.GRPCBin/RandomError
    done
else
    echo "  grpcurl not found — skipped (brew install grpcurl)"
fi

echo "== HTTP/3 (QUIC over the proxy's SOCKS5 UDP relay)"
# curl, Chrome & co. refuse HTTP/3 through any proxy, so a small quic-go client in
# examples/h3-probe speaks SOCKS5 UDP ASSOCIATE to Tapline's mixed listener instead.
if command -v go >/dev/null 2>&1; then
    proxy=${HTTPS_PROXY:-${https_proxy:-http://127.0.0.1:3606}}
    proxy=${proxy#*://}
    proxy=${proxy%/}
    if [[ ! -f $H3_PROBE/main.go ]]; then
        echo "  h3-probe not found at $H3_PROBE — set H3_PROBE=/path/to/tapline/examples/h3-probe"
        ((fail++))
    elif (cd "$H3_PROBE" && go run . -proxy "$proxy" \
        https://cloudflare-quic.com/ \
        https://quic.nginx.org/ \
        https://www.google.com/generate_204 \
        https://http3.is/); then
        ((pass++))
    else
        ((fail++))
    fi
else
    echo "  go not found — skipped (needs Go 1.25+ for examples/h3-probe)"
fi

echo
echo "done: $pass ok, $fail failed"
[[ $fail -eq 0 ]]
