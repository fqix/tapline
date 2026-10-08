package engine

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/elazarl/goproxy"
	"github.com/gobwas/ws"
	"github.com/fqix/tapline/engine/internal/ipc"
)

const maxWebSocketMessage = 100 * 1024 * 1024

func isWebSocket(headers http.Header) bool {
	return strings.EqualFold(headers.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(headers.Get("Connection")), "upgrade")
}

func (r *runtime) websocketRequest(req *http.Request, pc *goproxy.ProxyCtx, ex *exchange) (*http.Request, *http.Response) {
	session := ex.session
	session.websocket = true
	target := *req.URL
	if target.Scheme == "https" {
		target.Scheme = "wss"
	} else {
		target.Scheme = "ws"
	}
	result, err := r.peer.Ask(req.Context(), map[string]any{
		"type": "websocket", "id": session.id, "url": target.String(),
		"headers": ipc.NodeHeaders(req.Header), "socket": r.socketMetadata(req),
	})
	if err != nil {
		return req, failedResponse(req, session, err)
	}
	req.Header = ipc.HTTPHeaders(result.Options.Headers)
	// Forward uncompressed frames so message edits preserve payload boundaries.
	req.Header.Del("Sec-WebSocket-Extensions")
	req.Header.Del("Proxy-Authorization")
	req.Header.Del("Proxy-Connection")
	req.RequestURI = ""
	r.setRoundTripper(pc, result.Options, result.Route, ex, true)
	return req, nil
}

func (r *runtime) websocketResponse(resp *http.Response, pc *goproxy.ProxyCtx, ex *exchange) *http.Response {
	if resp == nil || resp.StatusCode != http.StatusSwitchingProtocols {
		return failedResponse(pc.Req, ex.session, errors.New("upstream rejected WebSocket upgrade"))
	}
	body, ok := resp.Body.(*forwardBody)
	if !ok {
		return failedResponse(pc.Req, ex.session, errors.New("missing WebSocket response body"))
	}
	upstream, ok := body.body.(io.ReadWriteCloser)
	if !ok {
		return failedResponse(pc.Req, ex.session, errors.New("upstream is not a WebSocket connection"))
	}
	if err := r.peer.Send(map[string]any{
		"type": "upstream-connected", "id": ex.session.id, "address": ex.address(),
	}); err != nil {
		closeQuietly(upstream)
		return failedResponse(pc.Req, ex.session, err)
	}
	wsBody := newWebSocketBody(pc.Req.Context(), upstream, ex.session)
	body.body = wsBody
	return resp
}

func (b *forwardBody) Write(data []byte) (int, error) {
	writer, ok := b.body.(io.Writer)
	if !ok {
		return 0, errors.New("response body is not writable")
	}
	return writer.Write(data)
}

type websocketBody struct {
	upstream     io.ReadWriteCloser
	in           *io.PipeReader
	out          *io.PipeWriter
	inputWriter  *io.PipeWriter
	outputReader *io.PipeReader
	session      *session
	once         sync.Once
	sender       *websocketWriter
	closing      atomic.Bool
}

func newWebSocketBody(parent context.Context, upstream io.ReadWriteCloser, session *session) *websocketBody {
	in, inputWriter := io.Pipe()
	outputReader, out := io.Pipe()
	b := &websocketBody{
		sender:   &websocketWriter{target: upstream},
		upstream: upstream, in: in, inputWriter: inputWriter, out: out, outputReader: outputReader, session: session,
	}
	session.ws.Store(b)
	ctx, cancel := context.WithCancel(parent)
	context.AfterFunc(ctx, func() { closeQuietly(b) })
	session.workers.Go(func() { <-session.done; cancel() })
	transfer := func(source io.Reader, target io.Writer, fromServer bool) {
		err := relayWebSocket(ctx, source, target, session, fromServer)
		// Closing either relay also interrupts the other socket reader. That local
		// cleanup must not win the race to mark a completed close as a failure.
		closed := b.closing.Load() && errors.Is(err, net.ErrClosed)
		if !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrClosedPipe) && !closed {
			session.finish(false, err)
		}
		closeQuietly(b)
	}
	session.workers.Go(func() { transfer(upstream, inputWriter, true) })
	session.workers.Go(func() { transfer(outputReader, b.sender, false) })
	return b
}

func (b *websocketBody) Read(data []byte) (int, error)  { return b.in.Read(data) }
func (b *websocketBody) Write(data []byte) (int, error) { return b.out.Write(data) }
func (b *websocketBody) Close() error {
	b.once.Do(func() {
		b.closing.Store(true)
		closeQuietly(b.in)
		closeQuietly(b.inputWriter)
		closeQuietly(b.out)
		closeQuietly(b.outputReader)
		closeQuietly(b.upstream)
		b.session.finish(true, nil)
	})
	return nil
}

func relayWebSocket(ctx context.Context, source io.Reader, target io.Writer, session *session, fromServer bool) error {
	writer, ok := target.(*websocketWriter)
	if !ok {
		writer = &websocketWriter{target: target}
	}
	state := ws.StateServerSide
	if fromServer {
		state = ws.StateClientSide
	}
	fragments := []ws.Header{}
	payload := []byte{}
	binary := false
	for {
		header, err := ws.ReadHeader(source)
		if err != nil {
			return err
		}
		if err := ws.CheckHeader(header, state); err != nil {
			return fmt.Errorf("invalid WebSocket frame: %w", err)
		}
		if header.Length > maxWebSocketMessage-int64(len(payload)) || len(fragments) >= 65536 {
			return errors.New("WebSocket message exceeds size limit")
		}
		data := make([]byte, int(header.Length))
		if _, err := io.ReadFull(source, data); err != nil {
			return err
		}
		if header.Masked {
			ws.Cipher(data, header.Mask, 0)
		}
		if header.OpCode.IsControl() {
			if header.OpCode == ws.OpClose {
				if body := session.ws.Load(); body != nil {
					body.closing.Store(true)
				}
			}
			if header.Masked {
				ws.Cipher(data, header.Mask, 0)
			}
			if err := writer.control(ws.Frame{Header: header, Payload: data}); err != nil {
				return err
			}
			continue
		}
		if !state.Fragmented() {
			binary = header.OpCode == ws.OpBinary
		}
		fragments = append(fragments, header)
		payload = append(payload, data...)
		if !header.Fin {
			state |= ws.StateFragmented
			continue
		}
		state &^= ws.StateFragmented
		if !binary && !utf8.Valid(payload) {
			return errors.New("invalid WebSocket UTF-8 message")
		}
		frameID := fmt.Sprint(session.runtime.sequence.Add(1))
		result, err := session.runtime.peer.Ask(ctx, map[string]any{
			"type": "frame", "id": frameID, "frameId": frameID, "session": session.id,
			"fromServer": fromServer, "data": ipc.Bytes(payload), "binary": binary,
		})
		if err != nil {
			return err
		}
		if err := writer.message(result.Data, result.Binary, fragments); err != nil {
			return err
		}
		fragments = fragments[:0]
		payload = payload[:0]
	}
}

func writeFragments(writer io.Writer, data []byte, binary bool, fragments []ws.Header) error {
	lengths := make([]int, 0, len(fragments))
	original := 0
	for _, header := range fragments {
		lengths = append(lengths, int(header.Length))
		original += int(header.Length)
	}
	if original != len(data) {
		remaining, largest := len(data), 1
		lengths = lengths[:0]
		for _, header := range fragments {
			largest = max(largest, int(header.Length))
			length := min(int(header.Length), remaining)
			lengths = append(lengths, length)
			remaining -= length
			if remaining == 0 {
				break
			}
		}
		for remaining > 0 {
			length := min(remaining, largest)
			lengths = append(lengths, length)
			remaining -= length
		}
	}
	offset := 0
	for index, length := range lengths {
		header := fragments[min(index, len(fragments)-1)]
		header.OpCode = ws.OpContinuation
		if index == 0 {
			header.OpCode = ws.OpText
			if binary {
				header.OpCode = ws.OpBinary
			}
		}
		header.Fin = index == len(lengths)-1
		header.Length = int64(length)
		part := append([]byte{}, data[offset:offset+length]...)
		offset += length
		if header.Masked {
			ws.Cipher(part, header.Mask, 0)
		}
		if err := ws.WriteFrame(writer, ws.Frame{Header: header, Payload: part}); err != nil {
			return err
		}
	}
	return nil
}

// Serialize whole messages, including all fragments, with normal client traffic.
// Locking individual Write calls would allow a resend to split a frame on the wire.
type websocketWriter struct {
	target io.Writer
	mu     sync.Mutex
}

func (w *websocketWriter) Write(data []byte) (int, error) { return w.target.Write(data) }

func (w *websocketWriter) message(data []byte, binary bool, fragments []ws.Header) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return writeFragments(w.target, data, binary, fragments)
}

func (w *websocketWriter) control(frame ws.Frame) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return ws.WriteFrame(w.target, frame)
}

// Never block the IPC reader: normal relays need it to receive frame-result replies.
// One outstanding resend per connection bounds workers even if the upstream stalls.
func (r *runtime) sendWebSocket(parent context.Context, msg ipc.Message) {
	reply := func(err error) {
		result := ipc.Message{Type: "websocket-send-result", ID: msg.ID}
		if err != nil {
			result.Error = err.Error()
		}
		if r.peer.Send(result) != nil {
			r.peer.Fail()
		}
	}
	value, ok := r.sessions.Load(msg.Session)
	if !ok {
		reply(errors.New("WebSocket connection is closed"))
		return
	}
	session := value.(*session)
	body := session.ws.Load()
	if body == nil || body.closing.Load() {
		reply(errors.New("WebSocket connection is not open"))
		return
	}
	if len(msg.Data) > maxWebSocketMessage || (!msg.Binary && !utf8.Valid(msg.Data)) {
		reply(errors.New("Invalid WebSocket payload"))
		return
	}
	if !session.resending.CompareAndSwap(false, true) {
		reply(errors.New("A WebSocket resend is already in progress"))
		return
	}
	session.workers.Go(func() {
		defer session.resending.Store(false)
		ctx, cancel := context.WithTimeout(parent, 5*time.Second)
		defer cancel()
		// Closing the transport unblocks both a stalled write and any queued writer.
		stop := context.AfterFunc(ctx, func() { closeQuietly(body) })
		defer stop()
		body.sender.mu.Lock()
		var err error
		if body.closing.Load() {
			err = errors.New("WebSocket connection is closed")
		} else {
			// Every injected client message uses a fresh unpredictable mask.
			var mask [4]byte
			if _, err = rand.Read(mask[:]); err == nil {
				err = writeFragments(body.sender.target, msg.Data, msg.Binary,
					[]ws.Header{{Fin: true, Masked: true, Mask: mask, Length: int64(len(msg.Data))}})
			}
		}
		body.sender.mu.Unlock()
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		if err != nil {
			closeQuietly(body)
		}
		reply(err)
	})
}
