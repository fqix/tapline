package ipc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
)

func (p *Peer) Reader(ctx context.Context, id string, trailers http.Header) *BodyReader {
	r := &BodyReader{
		peer: p, id: id, done: ctx.Done(), messages: make(chan Message, 1), trailers: trailers,
	}
	p.mu.Lock()
	p.readers[id] = r
	p.mu.Unlock()
	return r
}

func (p *Peer) Pipe(ctx context.Context, id string, body io.ReadCloser, trailers func() http.Header) error {
	credit := make(chan struct{}, 1)
	p.mu.Lock()
	p.credits[id] = credit
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.credits, id)
		p.mu.Unlock()
	}()
	stop := context.AfterFunc(ctx, func() { closeQuietly(body) })
	defer stop()
	defer closeQuietly(body)
	buffer := make([]byte, chunkSize)
	for {
		n, err := body.Read(buffer)
		if n > 0 {
			if sendErr := p.Send(Message{Type: "chunk", Stream: id, Data: buffer[:n]}); sendErr != nil {
				return sendErr
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-credit:
			}
		}
		if errors.Is(err, io.EOF) {
			values := make(http.Header)
			if trailers != nil {
				values = trailers()
			}
			return p.Send(Message{Type: "end", Stream: id, Trailers: NodeHeaders(values)})
		}
		if err != nil {
			return fmt.Errorf("read forwarded body: %w", err)
		}
	}
}

type BodyReader struct {
	peer     *Peer
	id       string
	done     <-chan struct{}
	messages chan Message
	buffer   []byte
	trailers http.Header
	eof      bool
}

func (r *BodyReader) Read(buffer []byte) (int, error) {
	if r.eof {
		return 0, io.EOF
	}
	for len(r.buffer) == 0 {
		select {
		case <-r.done:
			return 0, context.Canceled
		case msg := <-r.messages:
			if msg.Type == "end" {
				for name, values := range HTTPHeaders(msg.Trailers) {
					r.trailers[name] = values
				}
				r.eof = true
				return 0, io.EOF
			}
			r.buffer = msg.Data
			if len(r.buffer) == 0 {
				if err := r.ack(); err != nil {
					return 0, err
				}
			}
		}
	}
	n := copy(buffer, r.buffer)
	r.buffer = r.buffer[n:]
	if len(r.buffer) == 0 {
		if err := r.ack(); err != nil {
			return n, err
		}
	}
	return n, nil
}

func (r *BodyReader) ack() error {
	return r.peer.Send(Message{Type: "credit", Stream: r.id})
}

func (r *BodyReader) Close() error { return nil }

// Messages exposes the pending stream frame for the CONNECT inspection handoff.
// The caller puts the frame back before handing the stream to Read.
func (r *BodyReader) Messages() chan Message { return r.messages }

// Trailers returns the header map populated when Read consumes the end frame.
func (r *BodyReader) Trailers() http.Header { return r.trailers }

// EOF reports whether Read consumed the end frame.
func (r *BodyReader) EOF() bool { return r.eof }
