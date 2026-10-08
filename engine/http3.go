package engine

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/elazarl/goproxy"
	"github.com/sagernet/quic-go"
	"github.com/sagernet/quic-go/http3"
)

type quicSourceKey struct{}
type quicInboundKey struct{}
type quicDestinationKey struct{}

// ServePacket owns one routed UDP flow. The caller supplies a packet connection
// whose peer is the original client, not the flow's destination address.
func (e *Engine) ServePacket(ctx context.Context, packets net.PacketConn, source netip.AddrPort, destination, serverName string, http3Protocol bool) error {
	defer closeQuietly(packets)
	e.packetMu.Lock()
	if e.ctx.Err() != nil {
		e.packetMu.Unlock()
		return net.ErrClosed
	}
	e.packets.Add(1)
	e.packetMu.Unlock()
	defer e.packets.Done()
	if !source.IsValid() || source.Port() == 0 {
		return errors.New("inspection source endpoint is required")
	}
	host, port, err := net.SplitHostPort(destination)
	if err != nil {
		return fmt.Errorf("invalid QUIC destination: %w", err)
	}
	if serverName == "" {
		serverName = host
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stopEngine := context.AfterFunc(e.ctx, cancel)
	defer stopEngine()
	stopPackets := context.AfterFunc(ctx, func() { closeQuietly(packets) })
	defer stopPackets()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-e.ready:
	}
	r := e.runtime
	if !http3Protocol {
		if r.transports.DialUDP == nil {
			return errors.New("only HTTP/3 UDP is supported by the proxy listener")
		}
		return e.relayPacket(ctx, packets, destination, source, "")
	}
	inbound := e.inboundOf(ctx)
	policyCtx, policyCancel := context.WithTimeout(ctx, 15*time.Second)
	policy, err := r.peer.Ask(policyCtx, map[string]any{
		"type": "quic", "id": fmt.Sprint(r.sequence.Add(1)), "host": serverName, "inbound": inbound,
	})
	policyCancel()
	if err != nil {
		return err
	}
	if !policy.Inspect {
		return e.relayPacket(ctx, packets, destination, source, policy.Route)
	}
	transport := &quic.Transport{Conn: packets}
	defer closeQuietly(transport)
	config := &tls.Config{
		MinVersion: tls.VersionTLS13,
		NextProtos: []string{http3.NextProtoH3},
		GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
			if hello.ServerName != "" && !strings.EqualFold(hello.ServerName, serverName) {
				return nil, errors.New("QUIC server name differs from routed destination")
			}
			req := (&http.Request{}).WithContext(hello.Context())
			config, err := r.tlsConfig(net.JoinHostPort(serverName, port), &goproxy.ProxyCtx{Req: req, Proxy: r.proxyServer})
			if err != nil {
				return nil, err
			}
			config = config.Clone()
			config.MinVersion = tls.VersionTLS13
			config.NextProtos = []string{http3.NextProtoH3}
			return config, nil
		},
	}
	listener, err := transport.Listen(config, &quic.Config{
		HandshakeIdleTimeout: 10 * time.Second,
		MaxIdleTimeout:       90 * time.Second,
		MaxIncomingStreams:   100,
		// Do not accept replayable early requests at an interception endpoint.
		Allow0RTT: false,
	})
	if err != nil {
		return err
	}
	defer closeQuietly(listener)
	acceptCtx, acceptCancel := context.WithTimeout(ctx, 15*time.Second)
	conn, err := listener.Accept(acceptCtx)
	acceptCancel()
	if err != nil {
		return err
	}
	defer conn.CloseWithError(0, "inspection finished")
	server := &http3.Server{
		MaxHeaderBytes: 1 << 20,
		ConnContext: func(ctx context.Context, _ *quic.Conn) context.Context {
			ctx = context.WithValue(ctx, quicSourceKey{}, source)
			ctx = context.WithValue(ctx, quicInboundKey{}, inbound)
			return context.WithValue(ctx, quicDestinationKey{}, destination)
		},
		Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// A new authority needs its own SSL policy and certificate decision.
			authority := req.Host
			if name, _, err := net.SplitHostPort(authority); err == nil {
				authority = name
			}
			authority = strings.Trim(authority, "[]")
			if !strings.EqualFold(authority, serverName) {
				http.Error(w, "Use a separate connection for this authority", http.StatusMisdirectedRequest)
				return
			}
			if req.Method == http.MethodConnect {
				http.Error(w, "Extended CONNECT is not supported", http.StatusNotImplemented)
				return
			}
			req.URL.Scheme, req.URL.Host = "https", req.Host
			flushHandler{r.proxyServer}.ServeHTTP(w, req)
		}),
	}
	defer closeQuietly(server)
	stopServer := context.AfterFunc(ctx, func() { closeQuietly(server) })
	defer stopServer()
	return server.ServeQUICConn(conn)
}

// Bypassed SSL domains retain their encrypted UDP stream and configured egress.
func (e *Engine) relayPacket(ctx context.Context, packets net.PacketConn, destination string, source netip.AddrPort, route string) error {
	dial := e.runtime.transports.DialUDP
	if dial == nil {
		if route != "" {
			return errors.New("upstream proxy routing requires SSL inspection for QUIC")
		}
		dial = func(ctx context.Context, address string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "udp", address)
		}
	}
	upstream, err := dial(ctx, destination)
	if err != nil {
		return err
	}
	defer closeQuietly(upstream)
	stop := context.AfterFunc(ctx, func() { closeQuietly(upstream) })
	defer stop()
	result := make(chan error, 1)
	go func() {
		defer closeQuietly(upstream)
		buffer := make([]byte, 65535)
		for {
			if err := packets.SetReadDeadline(time.Now().Add(90 * time.Second)); err != nil {
				result <- err
				return
			}
			n, _, err := packets.ReadFrom(buffer)
			if err == nil {
				_, err = upstream.Write(buffer[:n])
			}
			if err != nil {
				result <- err
				closeQuietly(upstream)
				return
			}
		}
	}()
	buffer := make([]byte, 65535)
	for {
		if err = upstream.SetReadDeadline(time.Now().Add(90 * time.Second)); err != nil {
			break
		}
		var n int
		n, err = upstream.Read(buffer)
		if err == nil {
			_, err = packets.WriteTo(buffer[:n], net.UDPAddrFromAddrPort(source))
		}
		if err != nil {
			break
		}
	}
	closeQuietly(packets)
	closeQuietly(upstream)
	<-result
	if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) {
		return nil
	}
	return err
}
