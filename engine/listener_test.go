package engine

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

// Hold a deadline reset before the underlying connection sees it, as can happen
// when the setter is descheduled while the read pump handles the old timeout.
type delayedDeadlineConn struct {
	net.Conn
	resetStarted chan struct{}
	resetAllowed chan struct{}
	reads        chan struct{}
}

func (c *delayedDeadlineConn) Read(data []byte) (int, error) {
	c.reads <- struct{}{}
	return c.Conn.Read(data)
}

func (c *delayedDeadlineConn) SetReadDeadline(deadline time.Time) error {
	if deadline.IsZero() {
		close(c.resetStarted)
		<-c.resetAllowed
	}
	return c.Conn.SetReadDeadline(deadline)
}

func TestTrackedConnDeadlineResetIsAtomic(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	client, server := net.Pipe()
	defer closeQuietly(client)
	delayed := &delayedDeadlineConn{
		Conn: server, resetStarted: make(chan struct{}), resetAllowed: make(chan struct{}),
		reads: make(chan struct{}, 4),
	}
	conn := &trackedConn{
		Conn: delayed, ctx: ctx, cancel: cancel, connections: &sync.Map{},
		incoming: make(chan connectionRead, 1), readWake: make(chan struct{}, 1),
	}
	defer closeQuietly(conn)
	if err := conn.SetReadDeadline(time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	var workers sync.WaitGroup
	workers.Go(conn.pump)
	<-delayed.reads
	// It must not retry Read until the real deadline is cleared.
	firstTimeout := <-conn.incoming
	var timeout net.Error
	if !errors.As(firstTimeout.err, &timeout) || !timeout.Timeout() {
		t.Fatalf("wanted original timeout, got %v", firstTimeout.err)
	}
	workers.Go(func() {
		if err := conn.SetReadDeadline(time.Time{}); err != nil {
			t.Error(err)
		}
	})
	<-delayed.resetStarted
	// Wake the pump to inspect the new deadline before the reset finishes.
	conn.readWake <- struct{}{}
	select {
	case <-delayed.reads:
		t.Error("read restarted before deadline reset completed")
	case <-time.After(50 * time.Millisecond):
	}
	close(delayed.resetAllowed)
	var buffer [4]byte
	workers.Go(func() {
		if _, err := client.Write([]byte("next")); err != nil {
			t.Error(err)
		}
	})
	if _, err := io.ReadFull(conn, buffer[:]); err != nil {
		t.Errorf("read after reset: %v", err)
	}
	closeQuietly(conn)
	workers.Wait()
}

func TestTrackedConnReadDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		client, server := net.Pipe()
		defer closeQuietly(client)
		conn := &trackedConn{
			Conn: server, ctx: ctx, cancel: cancel, connections: &sync.Map{},
			incoming: make(chan connectionRead, 1), readWake: make(chan struct{}, 1),
		}
		defer closeQuietly(conn)
		var workers sync.WaitGroup
		workers.Go(conn.pump)
		if err := conn.SetReadDeadline(time.Now().Add(-time.Second)); err != nil {
			t.Fatal(err)
		}
		var buffer [4]byte
		_, err := conn.Read(buffer[:])
		var timeout net.Error
		if !errors.As(err, &timeout) || !timeout.Timeout() {
			t.Fatalf("wanted read timeout, got %v", err)
		}
		if ctx.Err() != nil {
			t.Fatal("HTTP hijack wakeup cancelled the connection")
		}
		if err := conn.SetReadDeadline(time.Time{}); err != nil {
			t.Fatal(err)
		}
		workers.Go(func() {
			if _, err := client.Write([]byte("next")); err != nil {
				t.Error(err)
			}
		})
		if _, err := io.ReadFull(conn, buffer[:]); err != nil {
			t.Fatal(err)
		}
		if string(buffer[:]) != "next" {
			t.Fatal("lost buffered bytes after deadline reset")
		}
		// No consumer read is pending: cancellation must still notice client EOF.
		closeQuietly(client)
		synctest.Wait()
		if ctx.Err() == nil {
			t.Fatal("missed a client disconnect during an idle stream")
		}
		workers.Wait()
	})
}

func TestTrackedConnDiscardsTimeoutAfterDeadlineReset(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		client, server := net.Pipe()
		defer closeQuietly(client)
		conn := &trackedConn{
			Conn: server, ctx: ctx, cancel: cancel, connections: &sync.Map{},
			incoming: make(chan connectionRead, 1), readWake: make(chan struct{}, 1),
		}
		defer closeQuietly(conn)
		if err := conn.SetReadDeadline(time.Now().Add(-time.Second)); err != nil {
			t.Fatal(err)
		}
		var workers sync.WaitGroup
		workers.Go(conn.pump)
		synctest.Wait()
		// HTTP can finish its background read using buffered data and clear the
		// deadline while the read-ahead pump still has the old timeout queued.
		if err := conn.SetReadDeadline(time.Time{}); err != nil {
			t.Fatal(err)
		}
		workers.Go(func() {
			if _, err := client.Write([]byte("next")); err != nil {
				t.Error(err)
			}
		})
		var buffer [4]byte
		if _, err := io.ReadFull(conn, buffer[:]); err != nil {
			t.Errorf("read after reset: %v", err)
		} else if string(buffer[:]) != "next" {
			t.Error("lost data after deadline reset")
		}
		closeQuietly(conn)
		workers.Wait()
	})
}
