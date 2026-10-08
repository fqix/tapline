package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fqix/tapline/engine/internal/ipc"
)

type session struct {
	id             string
	runtime        *runtime
	cancel         context.CancelFunc
	done           <-chan struct{}
	once           sync.Once
	workers        sync.WaitGroup
	local          bool
	websocket      bool
	ws             atomic.Pointer[websocketBody]
	resending      atomic.Bool
	delivered      atomic.Bool
	disconnectOnce sync.Once
}

func (r *runtime) session(parent context.Context) (context.Context, *session) {
	// A client may close immediately after Content-Length bytes, before the last
	// capture credit arrives. Let that completed body drain before cancelling.
	ctx, cancel := context.WithCancel(context.WithoutCancel(parent))
	s := &session{
		id: fmt.Sprint(r.sequence.Add(1)), runtime: r, cancel: cancel, done: ctx.Done(),
	}
	r.sessions.Store(s.id, s)
	stop := context.AfterFunc(parent, s.disconnected)
	context.AfterFunc(ctx, func() { stop(); s.finish(false, nil) })
	return ctx, s
}

func (s *session) disconnected() {
	if !s.delivered.Load() {
		s.finish(false, nil)
		return
	}
	s.disconnectOnce.Do(func() {
		s.workers.Go(func() {
			timer := time.NewTimer(5 * time.Second)
			defer timer.Stop()
			select {
			case <-s.done:
			case <-timer.C:
				s.finish(false, errors.New("timed out draining captured response"))
			}
		})
	})
}

func (s *session) finish(completed bool, err error) {
	s.once.Do(func() {
		s.cancel()
		s.runtime.sessions.Delete(s.id)
		s.runtime.peer.RemoveStreams(s.id + ":")
		if err != nil && !errors.Is(err, context.Canceled) {
			if sendErr := s.runtime.peer.Send(ipc.Message{Type: "failure", ID: s.id, Error: err.Error()}); sendErr != nil {
				slog.Debug("send proxy failure", "error", sendErr)
			}
		}
		if sendErr := s.runtime.peer.Send(map[string]any{
			"type": "closed", "id": s.id, "aborted": !completed,
		}); sendErr != nil {
			slog.Debug("send proxy close", "error", sendErr)
		}
	})
}

func (s *session) askBody(ctx context.Context, msg map[string]any, body io.ReadCloser, trailers func() http.Header) (ipc.Message, error) {
	phase := msg["type"].(string)
	msg["id"] = s.id
	peer := s.runtime.peer
	replies, remove := peer.Reply(phase + "-result:" + s.id)
	defer remove()
	if err := peer.Send(msg); err != nil {
		return ipc.Message{}, err
	}
	s.workers.Go(func() {
		if err := peer.Pipe(ctx, s.id+":"+phase+":in", body, trailers); err != nil {
			s.finish(false, err)
		}
	})
	select {
	case <-ctx.Done():
		return ipc.Message{}, ctx.Err()
	case result := <-replies:
		if result.Error != "" {
			return ipc.Message{}, errors.New(result.Error)
		}
		return result, nil
	}
}
