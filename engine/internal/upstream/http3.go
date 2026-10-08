package upstream

import (
	"context"
	"crypto/tls"
	"net"
	"net/http/httptrace"
	"time"

	"github.com/sagernet/quic-go"
	"github.com/sagernet/quic-go/http3"
)

func newHTTP3Transport(config *tls.Config, dial func(context.Context, string) (net.Conn, error), destination string) *http3.Transport {
	if dial == nil {
		dialer := &net.Dialer{Timeout: 15 * time.Second}
		dial = func(ctx context.Context, address string) (net.Conn, error) {
			return dialer.DialContext(ctx, "udp", address)
		}
	}
	return &http3.Transport{
		TLSClientConfig:    config,
		DisableCompression: true,
		QUICConfig:         &quic.Config{HandshakeIdleTimeout: 10 * time.Second, MaxIdleTimeout: 90 * time.Second},
		Dial: func(ctx context.Context, address string, tlsConfig *tls.Config, quicConfig *quic.Config) (*quic.Conn, error) {
			if destination != "" {
				address = destination
			}
			packets, err := dial(ctx, address)
			if err != nil {
				return nil, err
			}
			trace := httptrace.ContextClientTrace(ctx)
			if trace != nil && trace.TLSHandshakeStart != nil {
				trace.TLSHandshakeStart()
			}
			conn, err := quic.DialConn(ctx, packets, tlsConfig, quicConfig)
			if trace != nil && trace.TLSHandshakeDone != nil {
				var state tls.ConnectionState
				if conn != nil {
					state = conn.ConnectionState().TLS
				}
				trace.TLSHandshakeDone(state, err)
			}
			if err != nil {
				closeQuietly(packets)
				return nil, err
			}
			context.AfterFunc(conn.Context(), func() { closeQuietly(packets) })
			return conn, nil
		},
	}
}
