package ipc

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"testing"
	"testing/synctest"
)

func TestReadMessage(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		size uint32
		body []byte
	}{
		{name: "empty", size: 0},
		{name: "oversized", size: maxMessage + 1},
		{name: "truncated", size: 12, body: []byte("{}")},
		{name: "invalid JSON", size: 1, body: []byte("!")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := make([]byte, 4)
			binary.BigEndian.PutUint32(data, tc.size)
			if _, err := ReadMessage(bytes.NewReader(append(data, tc.body...))); err == nil {
				t.Fatal("accepted invalid frame")
			}
		})
	}
}

func TestPeerPipe(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		input, output := io.Pipe()
		defer closeQuietly(input)
		defer closeQuietly(output)
		peer := NewPeer(output, cancel)
		body := bytes.Repeat([]byte{0, 127, 255, 173}, chunkSize)
		finished := make(chan error, 1)
		go func() {
			finished <- peer.Pipe(ctx, "body", io.NopCloser(bytes.NewReader(body)), func() http.Header {
				return http.Header{"Grpc-Status": {"0"}, "X-Trailer": {"done"}}
			})
		}()
		received := []byte{}
		for range 4 {
			msg, err := ReadMessage(input)
			if err != nil {
				t.Fatal(err)
			}
			if msg.Type != "chunk" || len(msg.Data) != chunkSize {
				t.Fatalf("unexpected body chunk: %s/%d", msg.Type, len(msg.Data))
			}
			received = append(received, msg.Data...)
			synctest.Wait()
			select {
			case err := <-finished:
				t.Fatalf("producer bypassed credit: %v", err)
			default:
			}
			if err := peer.Receive(Message{Type: "credit", Stream: "body"}); err != nil {
				t.Fatal(err)
			}
		}
		end, err := ReadMessage(input)
		if err != nil {
			t.Fatal(err)
		}
		if end.Type != "end" || HTTPHeaders(end.Trailers).Get("Grpc-Status") != "0" {
			t.Fatal("lost late trailers")
		}
		if !bytes.Equal(body, received) {
			t.Fatal("body bytes changed")
		}
		if err := <-finished; err != nil {
			t.Fatal(err)
		}
	})
}

func TestPeerPipeCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		input, output := io.Pipe()
		defer closeQuietly(input)
		defer closeQuietly(output)
		peer := NewPeer(output, cancel)
		finished := make(chan error, 1)
		go func() {
			finished <- peer.Pipe(ctx, "body", io.NopCloser(bytes.NewReader(make([]byte, 2*chunkSize))), nil)
		}()
		if _, err := ReadMessage(input); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		cancel()
		if err := <-finished; !errors.Is(err, context.Canceled) {
			t.Fatalf("unexpected cancellation: %v", err)
		}
	})
}
