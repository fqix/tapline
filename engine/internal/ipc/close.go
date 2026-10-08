package ipc

import (
	"errors"
	"io"
	"log/slog"
	"net"
)

func closeQuietly(closer io.Closer) {
	// Cleanup must continue across already-closed sockets and cancelled streams.
	if closer != nil {
		if err := closer.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			slog.Debug("close proxy resource", "error", err)
		}
	}
}
