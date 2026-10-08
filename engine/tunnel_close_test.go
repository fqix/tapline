package engine

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"

	"github.com/fqix/tapline/engine/internal/ipc"
)

func TestTunnelCloseDoesNotReportTransportFailure(t *testing.T) {
	// Deterministically reproduce the E2E race: the client has consumed its
	// response and closes before trailing TLS bytes are copied to the pipe.
	client, server := net.Pipe()
	client.Close()
	defer server.Close()
	_, closedPipe := io.Copy(server, strings.NewReader("TLS close_notify"))
	if !errors.Is(closedPipe, io.ErrClosedPipe) {
		t.Fatalf("expected closed memory pipe, got %v", closedPipe)
	}
	for _, test := range []struct {
		name   string
		err    error
		failed bool
	}{
		{"EOF", nil, false},
		{"client closed pipe", closedPipe, false},
		{"wrapped closed pipe", fmt.Errorf("read forwarded body: %w", closedPipe), false},
		{"closed socket", &net.OpError{Op: "read", Net: "tcp", Err: net.ErrClosed}, true},
		{"transport error", errors.New("upstream transport failed"), true},
		{"truncated stream", io.ErrUnexpectedEOF, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			runtime := &runtime{peer: ipc.NewPeer(&output, cancel)}
			_, session := runtime.session(ctx)
			session.finishTunnel(test.err)
			if test.failed {
				failure, err := readControl(&output)
				if err != nil || failure["type"] != "failure" || failure["error"] != test.err.Error() {
					t.Fatalf("failure=%v err=%v", failure, err)
				}
			}
			closed, err := readControl(&output)
			if err != nil || closed["type"] != "closed" || closed["aborted"] != test.failed {
				t.Fatalf("closed=%v err=%v", closed, err)
			}
			if output.Len() != 0 {
				t.Fatal("unexpected extra lifecycle message")
			}
		})
	}
}
