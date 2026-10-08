package engine

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

const readBufferSize = 64 * 1024

type captureListener struct {
	net.Listener
	ready       chan net.Conn
	done        <-chan struct{}
	cancel      context.CancelFunc
	connections *sync.Map
	workers     sync.WaitGroup
}

func newCaptureListener(ctx context.Context, listener net.Listener, connections *sync.Map, prepare func(net.Conn) (net.Conn, error)) *captureListener {
	ctx, cancel := context.WithCancel(ctx)
	l := &captureListener{Listener: listener, ready: make(chan net.Conn), done: ctx.Done(), cancel: cancel, connections: connections}
	l.workers.Go(func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				cancel()
				return
			}
			connectionCtx, connectionCancel := context.WithCancel(ctx)
			tracked := &trackedConn{
				Conn: conn, ctx: connectionCtx, cancel: connectionCancel, connections: connections,
				incoming: make(chan connectionRead, 1), readWake: make(chan struct{}, 1),
			}
			l.workers.Go(tracked.pump)
			connections.Store(conn.RemoteAddr().String(), tracked)
			l.workers.Go(func() {
				var prepared net.Conn = tracked
				if prepare != nil {
					prepared, err = prepare(tracked)
					if err != nil {
						closeQuietly(tracked)
						return
					}
				}
				select {
				case <-ctx.Done():
					closeQuietly(tracked)
				case l.ready <- prepared:
				}
			})
		}
	})
	return l
}

func (l *captureListener) Accept() (net.Conn, error) {
	select {
	case <-l.done:
		return nil, net.ErrClosed
	case conn := <-l.ready:
		return conn, nil
	}
}

func (l *captureListener) Close() error {
	l.cancel()
	err := l.Listener.Close()
	l.connections.Range(func(_ any, value any) bool { closeQuietly(value.(net.Conn)); return true })
	l.workers.Wait()
	return err
}

type trackedConn struct {
	net.Conn
	// This context belongs to the connection lifetime, including hijacked MITM
	// requests whose library-created request contexts do not inherit ConnContext.
	ctx                context.Context
	cancel             context.CancelFunc
	connections        *sync.Map
	once               sync.Once
	incoming           chan connectionRead
	buffer             []byte
	readErr            error
	deadlineMu         sync.Mutex
	deadline           time.Time
	readWake           chan struct{}
	closeAfterResponse atomic.Bool
	ingressSource      atomic.Pointer[net.TCPAddr]
	// The pump's final read error. A peer close is reported as itself rather
	// than as a locally closed connection.
	peerErr atomic.Pointer[error]
}

type connectionRead struct {
	data []byte
	err  error
}

// One read ahead detects a closed TLS client even while goproxy is waiting at
// response headers or in an indefinite SSE body. The single slot bounds memory
// and retains pipelined requests for the normal HTTP parser.
func (c *trackedConn) pump() {
	for {
		data := make([]byte, readBufferSize)
		n, err := c.Conn.Read(data)
		var networkError net.Error
		timeout := errors.As(err, &networkError) && networkError.Timeout()
		if err != nil && !timeout {
			c.peerErr.Store(&err)
			c.cancel()
			return
		}
		select {
		case <-c.ctx.Done():
			return
		case c.incoming <- connectionRead{data: data[:n], err: err}:
		}
		if timeout {
			for {
				c.deadlineMu.Lock()
				deadline := c.deadline
				c.deadlineMu.Unlock()
				if deadline.IsZero() || deadline.After(time.Now()) {
					break
				}
				select {
				case <-c.ctx.Done():
					return
				case <-c.readWake:
				}
			}
		}
	}
}

func (c *trackedConn) Read(data []byte) (int, error) {
	if c.closeAfterResponse.Load() {
		closeQuietly(c)
		return 0, io.EOF
	}
	for len(c.buffer) == 0 && c.readErr == nil {
		select {
		case <-c.ctx.Done():
			if err := c.peerErr.Load(); err != nil {
				return 0, *err
			}
			return 0, net.ErrClosed
		case result := <-c.incoming:
			var timeout net.Error
			if errors.As(result.err, &timeout) && timeout.Timeout() {
				c.deadlineMu.Lock()
				expired := !c.deadline.IsZero() && !c.deadline.After(time.Now())
				c.deadlineMu.Unlock()
				if !expired {
					// A background HTTP read may finish using buffered data before
					// the pump delivers its timeout. A reset invalidates that error.
					result.err = nil
				}
			}
			c.buffer, c.readErr = result.data, result.err
		}
	}
	n := copy(data, c.buffer)
	c.buffer = c.buffer[n:]
	if len(c.buffer) == 0 {
		err := c.readErr
		c.readErr = nil
		return n, err
	}
	return n, nil
}
func (c *trackedConn) SetReadDeadline(deadline time.Time) error {
	c.deadlineMu.Lock()
	defer c.deadlineMu.Unlock()
	// Publish a reset only after the socket has accepted it. Otherwise the
	// pump can retry against the expired deadline and queue a stale timeout.
	if err := c.Conn.SetReadDeadline(deadline); err != nil {
		return err
	}
	c.deadline = deadline
	select {
	case c.readWake <- struct{}{}:
	default:
	}
	return nil
}
func (c *trackedConn) SetDeadline(deadline time.Time) error {
	if err := c.SetReadDeadline(deadline); err != nil {
		return err
	}
	return c.SetWriteDeadline(deadline)
}
func (c *trackedConn) Close() error {
	c.once.Do(func() { c.cancel(); c.connections.Delete(c.RemoteAddr().String()) })
	return c.Conn.Close()
}

type bufferedConn struct {
	net.Conn
	reader io.Reader
}

func (c *bufferedConn) Read(data []byte) (int, error) { return c.reader.Read(data) }
