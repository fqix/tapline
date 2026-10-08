// Tapline's HTTP transport. Policy stays in the Node agent; network I/O stays in goproxy.
package engine

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/elazarl/goproxy"

	"github.com/fqix/tapline/engine/internal/ipc"
	"github.com/fqix/tapline/engine/internal/upstream"
)

type runtime struct {
	listener    net.Listener
	cancel      context.CancelFunc
	ready       chan struct{}
	peer        *ipc.Peer
	sessions    sync.Map
	connections sync.Map
	sequence    atomic.Uint64
	transports  upstream.Pool
	port        int
	ingressPort int
	proxyServer *goproxy.ProxyHttpServer
	tlsConfig   func(string, *goproxy.ProxyCtx) (*tls.Config, error)
}

func newControlPeer(output io.Writer, cancel context.CancelFunc) *ipc.Peer {
	return ipc.NewPeer(output, cancel)
}

func (r *runtime) closeResources() {
	r.connections.Range(func(_ any, value any) bool {
		closeQuietly(value.(net.Conn))
		return true
	})
	r.sessions.Range(func(_ any, value any) bool {
		value.(*session).finish(false, nil)
		return true
	})
	r.transports.Close()
}

func (r *runtime) run(ctx context.Context, input io.Reader) error {
	start, err := ipc.ReadMessage(input)
	if err != nil {
		return err
	}
	if start.Type != "start" || start.Root == nil {
		return errors.New("expected start message with root identity")
	}
	r.ingressPort = start.IngressPort
	proxy, err := r.proxy(*start.Root)
	if err != nil {
		return err
	}
	r.port = start.IngressPort
	r.proxyServer = proxy
	capture := newCaptureListener(ctx, r.listener, &r.connections, prepareInProcess)
	server := &http.Server{
		Handler:           flushHandler{proxy},
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	defer func() { r.cancel(); closeQuietly(server) }()
	go func() {
		if err := server.Serve(capture); err != nil && !errors.Is(err, http.ErrServerClosed) && ctx.Err() == nil {
			slog.Error("proxy listener stopped", "error", err)
			r.peer.Fail()
		}
	}()
	if err := r.peer.Send(map[string]any{"type": "ready", "port": r.port, "in_process": true, "websocketSend": true, "dynamicInbounds": true}); err != nil {
		return err
	}
	close(r.ready)
	for {
		msg, err := ipc.ReadMessage(input)
		if err != nil {
			return err
		}
		if msg.Type == "inbound-add" || msg.Type == "inbound-remove" {
			handler, ok := ctx.Value(inboundControlKey{}).(InboundControl)
			port := 0
			var controlErr error
			if !ok {
				controlErr = errors.New("dynamic inbounds unavailable")
			} else {
				port, controlErr = handler(msg.Type, msg.Session, msg.Port)
			}
			if msg.Type == "inbound-remove" && controlErr == nil {
				r.connections.Range(func(_ any, value any) bool {
					c := value.(*trackedConn)
					if stream, ok := c.Conn.(*inspectionConn); ok && stream.inbound == msg.Session {
						closeQuietly(c)
					}
					return true
				})
			}
			result := map[string]any{"type": "inbound-result", "id": msg.ID, "port": port}
			if controlErr != nil {
				result["error"] = controlErr.Error()
			}
			if err := r.peer.Send(result); err != nil {
				return err
			}
			continue
		}
		if msg.Type == "websocket-send" {
			r.sendWebSocket(ctx, msg)
			continue
		}
		if msg.Type == "abort" {
			if value, ok := r.sessions.Load(msg.ID); ok {
				value.(*session).finish(false, nil)
			}
			continue
		}
		if err := r.peer.Receive(msg); err != nil {
			return err
		}
	}
}

func closeQuietly(closer io.Closer) {
	// Cleanup must continue across already-closed sockets and cancelled streams.
	if closer != nil {
		if err := closer.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			slog.Debug("close proxy resource", "error", err)
		}
	}
}
