#!/usr/bin/env python3
"""
Python HTTP Client Examples (GET, POST, DELETE)
Uses Python's standard library urllib.request (zero third-party dependencies).
Respects HTTP_PROXY / HTTPS_PROXY and SSL_CERT_FILE automatically.
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def get_base_url() -> str:
    return os.environ.get("HTTPBIN") or os.environ.get("BASE_URL") or "https://httpbin.org"


def create_ssl_context() -> ssl.SSLContext:
    ca_file = os.environ.get("SSL_CERT_FILE")
    if ca_file and os.path.exists(ca_file):
        return ssl.create_default_context(cafile=ca_file)
    return ssl.create_default_context()


def print_snippet(body_bytes: bytes) -> None:
    text = body_bytes.decode("utf-8", errors="replace")
    if len(text) > 200:
        print(f"    Body: {text[:200]}...")
    else:
        print(f"    Body: {text}")


def run_get(base_url: str, ssl_ctx: ssl.SSLContext) -> None:
    url = f"{base_url}/get?lang=python&sample=tapline"
    print(f"--> GET {url}")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "tapline-python-example/1.0",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
            body = resp.read()
            print(f"<-- {resp.status} {resp.reason} ({len(body)} bytes)")
            print_snippet(body)
    except urllib.error.HTTPError as e:
        print(f"<-- HTTP Error {e.code}: {e.reason}")
    print()


def run_post(base_url: str, ssl_ctx: ssl.SSLContext) -> None:
    url = f"{base_url}/post"
    payload = {
        "client": "tapline-python",
        "action": "create",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    data = json.dumps(payload).encode("utf-8")
    print(f"--> POST {url} (json body: {json.dumps(payload)})")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": "tapline-python-example/1.0",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
            body = resp.read()
            print(f"<-- {resp.status} {resp.reason} ({len(body)} bytes)")
            print_snippet(body)
    except urllib.error.HTTPError as e:
        print(f"<-- HTTP Error {e.code}: {e.reason}")
    print()


def run_delete(base_url: str, ssl_ctx: ssl.SSLContext) -> None:
    url = f"{base_url}/delete?id=42"
    print(f"--> DELETE {url}")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "tapline-python-example/1.0",
            "Accept": "application/json",
        },
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
            body = resp.read()
            print(f"<-- {resp.status} {resp.reason} ({len(body)} bytes)")
            print_snippet(body)
    except urllib.error.HTTPError as e:
        print(f"<-- HTTP Error {e.code}: {e.reason}")
    print()


def main() -> None:
    base_url = get_base_url()
    ssl_ctx = create_ssl_context()

    print(f"=== Running Python HTTP Client Examples (Base: {base_url}) ===\n")

    run_get(base_url, ssl_ctx)
    run_post(base_url, ssl_ctx)
    run_delete(base_url, ssl_ctx)

    print("=== Finished Python HTTP Client Examples ===")


if __name__ == "__main__":
    main()
