package upstream

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/fqix/tapline/engine/internal/ipc"
	"golang.org/x/net/http2"
	xproxy "golang.org/x/net/proxy"
)

type reusableTransport interface {
	http.RoundTripper
	CloseIdleConnections()
}

type Pool struct {
	// DialUDP is the core's configured egress, including interface binding or SOCKS.
	// Set before the pool is first used. A nil value uses the normal direct dialer.
	DialUDP func(context.Context, string) (net.Conn, error)
	mu      sync.Mutex
	entries map[[32]byte]reusableTransport
	order   [][32]byte
}

func (p *Pool) Get(options ipc.RequestOptions, route string, h2c, websocket bool, http3Destination ...string) (reusableTransport, error) {
	h3 := len(http3Destination) != 0 && !websocket && !h2c && (route == "" || p.DialUDP != nil)
	destination := ""
	if h3 {
		destination = http3Destination[0]
	}
	encoded, err := json.Marshal([]any{route, options.CA, options.Cert, options.Key, options.Insecure, h2c, websocket, h3, destination})
	if err != nil {
		return nil, fmt.Errorf("encode transport settings: %w", err)
	}
	key := sha256.Sum256(encoded)
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing := p.entries[key]; existing != nil {
		return existing, nil
	}
	config, err := upstreamTLS(options)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		TLSClientConfig:       config,
		ForceAttemptHTTP2:     !websocket,
		DisableCompression:    true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	if route != "" {
		proxyURL, err := url.Parse(route)
		if err != nil {
			return nil, fmt.Errorf("parse upstream proxy: %w", err)
		}
		switch proxyURL.Scheme {
		case "http", "https":
			transport.Proxy = http.ProxyURL(proxyURL)
			if proxyURL.Scheme == "https" {
				// net/http otherwise reuses the origin's TLS verification policy for the proxy.
				proxyConfig := config.Clone()
				proxyConfig.InsecureSkipVerify = false
				proxyConfig.ServerName = proxyURL.Hostname()
				transport.DialTLSContext = (&tls.Dialer{NetDialer: dialer, Config: proxyConfig}).DialContext
			}
		case "socks", "socks5", "socks5h":
			proxyURL.Scheme = "socks5"
			socks, err := xproxy.FromURL(proxyURL, dialer)
			if err != nil {
				return nil, fmt.Errorf("configure SOCKS upstream: %w", err)
			}
			contextDialer, ok := socks.(xproxy.ContextDialer)
			if !ok {
				return nil, errors.New("SOCKS dialer does not support cancellation")
			}
			transport.DialContext = contextDialer.DialContext
		default:
			return nil, fmt.Errorf("unsupported upstream protocol %q", proxyURL.Scheme)
		}
	}
	var result reusableTransport = transport
	if h3 {
		result = newHTTP3Transport(config, p.DialUDP, destination)
	}
	if h2c {
		result = &http2.Transport{
			AllowHTTP: true,
			DialTLSContext: func(ctx context.Context, network, address string, _ *tls.Config) (net.Conn, error) {
				if transport.Proxy != nil {
					return connectHTTPProxy(ctx, transport, address)
				}
				return transport.DialContext(ctx, network, address)
			},
		}
	}
	if p.entries == nil {
		p.entries = make(map[[32]byte]reusableTransport)
	}
	if len(p.order) == 32 {
		oldest := p.order[0]
		p.entries[oldest].CloseIdleConnections()
		delete(p.entries, oldest)
		p.order = p.order[1:]
	}
	p.entries[key] = result
	p.order = append(p.order, key)
	return result, nil
}

func (p *Pool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, transport := range p.entries {
		transport.CloseIdleConnections()
	}
}
