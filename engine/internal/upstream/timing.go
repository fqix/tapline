package upstream

import (
	"crypto/tls"
	"net/http/httptrace"
	"sync"
	"time"
)

type Timing struct {
	mu                             sync.Mutex
	start, dns, connect, tls, sent time.Time
	values                         map[string]float64
	// Remote address of the connection the request went out on (reused ones included).
	address string
}

func NewTiming(start time.Time) *Timing {
	return &Timing{start: start, values: make(map[string]float64)}
}

func (t *Timing) Trace() *httptrace.ClientTrace {
	set := func(key string, since time.Time) {
		if !since.IsZero() {
			t.values[key] = float64(time.Since(since).Microseconds()) / 1000
		}
	}
	return &httptrace.ClientTrace{
		GetConn: func(string) { t.mu.Lock(); set("blocked", t.start); t.mu.Unlock() },
		GotConn: func(info httptrace.GotConnInfo) {
			if info.Conn == nil || info.Conn.RemoteAddr() == nil {
				return
			}
			t.mu.Lock()
			t.address = info.Conn.RemoteAddr().String()
			t.mu.Unlock()
		},
		DNSStart:          func(httptrace.DNSStartInfo) { t.mu.Lock(); t.dns = time.Now(); t.mu.Unlock() },
		DNSDone:           func(httptrace.DNSDoneInfo) { t.mu.Lock(); set("dns", t.dns); t.mu.Unlock() },
		ConnectStart:      func(string, string) { t.mu.Lock(); t.connect = time.Now(); t.mu.Unlock() },
		ConnectDone:       func(string, string, error) { t.mu.Lock(); set("connect", t.connect); t.mu.Unlock() },
		TLSHandshakeStart: func() { t.mu.Lock(); t.tls = time.Now(); t.mu.Unlock() },
		TLSHandshakeDone:  func(tls.ConnectionState, error) { t.mu.Lock(); set("ssl", t.tls); t.mu.Unlock() },
		WroteRequest:      func(httptrace.WroteRequestInfo) { t.mu.Lock(); t.sent = time.Now(); t.mu.Unlock() },
		GotFirstResponseByte: func() {
			t.mu.Lock()
			// A response can arrive before WroteRequest fires on the writer goroutine.
			// In that case there is no post-upload wait, but the phase is still present.
			t.values["wait"] = 0
			set("wait", t.sent)
			t.mu.Unlock()
		},
	}
}

// Address is the upstream endpoint ("ip:port") once a connection was obtained.
func (t *Timing) Address() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.address
}

func (t *Timing) Snapshot() map[string]float64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	result := make(map[string]float64, len(t.values))
	for key, value := range t.values {
		result[key] = value
	}
	return result
}
