package engine

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
)

// Engine owns the IPC streams and in-process connections until Close or IPC EOF.
// No TCP inspection listener is opened. Callers must not share these streams.
type Engine struct {
	ctx       context.Context
	cancel    context.CancelFunc
	runtime   *runtime
	input     io.ReadCloser
	output    io.WriteCloser
	listener  *streamListener
	ready     chan struct{}
	done      chan struct{}
	closeOnce sync.Once
	sequence  atomic.Uint64
	err       error
	packetMu  sync.Mutex
	packets   sync.WaitGroup
}

func NewEngine(parent context.Context, input io.ReadCloser, output io.WriteCloser, packetDialer ...func(context.Context, string) (net.Conn, error)) *Engine {
	ctx, cancel := context.WithCancel(parent)
	e := &Engine{ctx: ctx, cancel: cancel, input: input, output: output,
		ready: make(chan struct{}), done: make(chan struct{})}
	e.listener = &streamListener{ctx: ctx, cancel: cancel, connections: make(chan net.Conn)}
	e.runtime = &runtime{peer: newControlPeer(output, cancel), listener: e.listener, cancel: cancel, ready: e.ready}
	if len(packetDialer) != 0 {
		e.runtime.transports.DialUDP = packetDialer[0]
	}
	context.AfterFunc(ctx, e.closeIO)
	go func() {
		defer close(e.done)
		e.err = e.runtime.run(ctx, input)
		cancel()
		e.closeIO()
		e.packetMu.Lock()
		e.packets.Wait()
		e.packetMu.Unlock()
		e.runtime.closeResources()
	}()
	return e
}

func (e *Engine) closeIO() {
	e.closeOnce.Do(func() {
		closeQuietly(e.input)
		closeQuietly(e.output)
		closeQuietly(e.listener)
	})
}

func (e *Engine) Wait() error {
	<-e.done
	if errors.Is(e.err, io.EOF) || errors.Is(e.err, context.Canceled) || errors.Is(e.err, net.ErrClosed) {
		return nil
	}
	return e.err
}

func (e *Engine) Close() error {
	e.cancel()
	e.closeIO()
	<-e.done
	return nil
}

// DialContext preserves source identity out of band. rawHTTP forwards the original
// HTTP stream; other TCP streams enter the existing CONNECT/MITM policy flow.
func (e *Engine) DialContext(ctx context.Context, source netip.AddrPort, destination string, rawHTTP bool) (net.Conn, error) {
	if !source.IsValid() || source.Port() == 0 {
		return nil, errors.New("inspection source endpoint is required")
	}
	if !rawHTTP {
		if _, _, err := net.SplitHostPort(destination); err != nil || strings.ContainsAny(destination, "\r\n\t /?#") {
			return nil, errors.New("invalid inspection destination")
		}
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-e.ctx.Done():
		return nil, net.ErrClosed
	case <-e.ready:
	}
	client, server := net.Pipe()
	tag := e.inboundOf(ctx)
	conn := &inspectionConn{inbound: tag, Conn: server, source: source, destination: destination,
		rawHTTP: rawHTTP, id: fmt.Sprint(e.sequence.Add(1))}
	select {
	case <-ctx.Done():
		closeQuietly(client)
		closeQuietly(server)
		return nil, ctx.Err()
	case <-e.ctx.Done():
		closeQuietly(client)
		closeQuietly(server)
		return nil, net.ErrClosed
	case e.listener.connections <- conn:
	}
	if rawHTTP {
		return client, nil
	}
	// Consume only our synthetic CONNECT response, never the caller's TLS bytes.
	stop := context.AfterFunc(ctx, func() { closeQuietly(client) })
	defer stop()
	reader := bufio.NewReader(client)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		closeQuietly(client)
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		closeQuietly(client)
		return nil, fmt.Errorf("inspection CONNECT rejected: %s", response.Status)
	}
	return &bufferedConn{Conn: client, reader: reader}, nil
}

type memoryAddr string

func (a memoryAddr) Network() string { return "tapline" }
func (a memoryAddr) String() string  { return string(a) }

type inspectionConn struct {
	inbound string
	net.Conn
	source      netip.AddrPort
	destination string
	rawHTTP     bool
	id          string
}

func (c *inspectionConn) RemoteAddr() net.Addr { return memoryAddr(c.id) }

type streamListener struct {
	ctx         context.Context
	cancel      context.CancelFunc
	connections chan net.Conn
}

func (l *streamListener) Accept() (net.Conn, error) {
	select {
	case <-l.ctx.Done():
		return nil, net.ErrClosed
	case conn := <-l.connections:
		return conn, nil
	}
}
func (l *streamListener) Close() error   { l.cancel(); return nil }
func (l *streamListener) Addr() net.Addr { return memoryAddr("tapline-inspector") }

func prepareInProcess(conn net.Conn) (net.Conn, error) {
	tracked := conn.(*trackedConn)
	stream, ok := tracked.Conn.(*inspectionConn)
	if !ok {
		return nil, errors.New("inspection requires an in-process connection")
	}
	tracked.ingressSource.Store(net.TCPAddrFromAddrPort(stream.source))
	if stream.rawHTTP {
		return tracked, nil
	}
	header := "CONNECT " + stream.destination + " HTTP/1.1\r\nHost: " + stream.destination + "\r\n\r\n"
	return &bufferedConn{Conn: tracked, reader: io.MultiReader(strings.NewReader(header), tracked)}, nil
}

// Only in-process connection identity or routed QUIC metadata authorizes inspection.
func (r *runtime) hasIngress(req *http.Request) bool {
	if source, ok := req.Context().Value(quicSourceKey{}).(netip.AddrPort); ok && source.IsValid() {
		return true
	}
	value, ok := r.connections.Load(req.RemoteAddr)
	return ok && value.(*trackedConn).ingressSource.Load() != nil
}
