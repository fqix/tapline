//go:build integration

package engine

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/sagernet/quic-go"
	"github.com/sagernet/quic-go/http3"
	"github.com/fqix/tapline/engine/internal/ipc"
)

func TestHTTP3Inspection(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	originReceived := make(chan []byte, 8)
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {}))
	defer origin.Close()
	originPackets, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer originPackets.Close()
	originServer := &http3.Server{TLSConfig: origin.TLS, Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		data, err := io.ReadAll(req.Body)
		if err != nil {
			return
		}
		if req.ProtoMajor != 3 {
			t.Error("upstream was not HTTP/3")
		}
		originReceived <- data
		w.Header().Set("X-Origin", req.Header.Get("X-Edited"))
		w.Header().Set("Trailer", "X-Finished")
		w.WriteHeader(201)
		_, _ = w.Write(append([]byte("origin:"), data...))
		w.Header().Set("X-Finished", "yes")
	})}
	defer originServer.Close()
	go func() { _ = originServer.Serve(originPackets) }()
	originCA, _ := json.Marshal(string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: origin.Certificate().Raw})))
	in, writer := io.Pipe()
	reader, out := io.Pipe()
	engine := NewEngine(ctx, in, out, func(ctx context.Context, address string) (net.Conn, error) {
		if address != originPackets.LocalAddr().String() {
			return nil, fmt.Errorf("lost captured Alt-Svc endpoint: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, "udp", address)
	})
	defer engine.Close()
	defer writer.Close()
	defer reader.Close()
	controller := ipc.NewPeer(writer, cancel)
	identity := testIdentity(t)
	if err := controller.Send(ipc.Message{Type: "start", Root: &identity, IngressPort: 6060}); err != nil {
		t.Fatal(err)
	}
	if _, err := readControl(reader); err != nil {
		t.Fatal(err)
	}
	paused, resume := make(chan struct{}), make(chan struct{})
	requestSeen := make(chan map[string]any, 8)
	responseSeen := make(chan map[string]any, 8)
	controlDone := make(chan struct{})
	var workers sync.WaitGroup
	go func() {
		defer close(controlDone)
		defer workers.Wait()
		contexts := make(map[string]context.Context)
		cancels := make(map[string]context.CancelFunc)
		defer func() {
			for _, stop := range cancels {
				stop()
			}
		}()
		for {
			message, err := readControl(reader)
			if err != nil {
				return
			}
			id, _ := message["id"].(string)
			switch message["type"] {
			case "quic":
				_ = controller.Send(ipc.Message{Type: "quic-result", ID: id, Inspect: true})
			case "certificate":
				_ = controller.Send(ipc.Message{Type: "certificate-result", ID: id})
			case "request":
				requestSeen <- message
				request := message["request"].(map[string]any)
				requestCtx, stop := context.WithCancel(ctx)
				contexts[id], cancels[id] = requestCtx, stop
				body := controller.Reader(requestCtx, id+":request:in", make(http.Header))
				workers.Go(func() {
					data, err := io.ReadAll(body)
					if err != nil {
						return
					}
					if strings.HasSuffix(request["url"].(string), "/paused") {
						close(paused)
						select {
						case <-resume:
						case <-requestCtx.Done():
							return
						}
					}
					data = append([]byte("edited:"), data...)
					options := ipc.RequestOptions{Method: "POST", CA: originCA, Headers: map[string]any{"content-length": strconv.Itoa(len(data)), "x-edited": "yes"}}
					if controller.Send(ipc.Message{Type: "request-result", ID: id, URL: request["url"].(string), Options: options}) == nil {
						_ = controller.Pipe(requestCtx, id+":request:out", io.NopCloser(bytes.NewReader(data)), nil)
					}
				})
			case "response":
				responseSeen <- message
				requestCtx := contexts[id]
				trailers := make(http.Header)
				body := controller.Reader(requestCtx, id+":response:in", trailers)
				workers.Go(func() {
					data, err := io.ReadAll(body)
					if err != nil {
						return
					}
					data = append(data, []byte(":modified")...)
					if controller.Send(ipc.Message{Type: "response-result", ID: id, Status: 202, Headers: map[string]any{"content-length": strconv.Itoa(len(data)), "x-response-edit": "yes"}}) == nil {
						_ = controller.Pipe(requestCtx, id+":response:out", io.NopCloser(bytes.NewReader(data)), func() http.Header { return trailers })
					}
				})
			case "closed":
				if stop := cancels[id]; stop != nil {
					stop()
					delete(cancels, id)
					delete(contexts, id)
				}
			default:
				encoded, _ := json.Marshal(message)
				var msg ipc.Message
				if json.Unmarshal(encoded, &msg) == nil {
					_ = controller.Receive(msg)
				}
			}
		}
	}()
	inspectorPackets, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	clientPackets, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer clientPackets.Close()
	source := netip.MustParseAddrPort(clientPackets.LocalAddr().String())
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- engine.ServePacket(ctx, inspectorPackets, source, originPackets.LocalAddr().String(), "example.com", true)
	}()
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(identity.Certificate))
	transport := &http3.Transport{TLSClientConfig: &tls.Config{RootCAs: roots}, Dial: func(ctx context.Context, _ string, config *tls.Config, qc *quic.Config) (*quic.Conn, error) {
		return quic.DialEarly(ctx, clientPackets, inspectorPackets.LocalAddr(), config, qc)
	}}
	defer transport.Close()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	// The HTTP authority uses 443 while the captured QUIC endpoint uses an
	// alternative port, as advertised by Alt-Svc in real deployments.
	url := "https://example.com"
	request := func(path string, data []byte) error {
		req, _ := http.NewRequestWithContext(ctx, "POST", url+path, bytes.NewReader(data))
		req.Header.Set("X-Tapline-Source", "1.2.3.4:9999")
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		want := append(append([]byte("origin:edited:"), data...), []byte(":modified")...)
		if !bytes.Equal(body, want) || resp.StatusCode != 202 || resp.ProtoMajor != 3 || resp.Header.Get("X-Response-Edit") != "yes" || resp.Trailer.Get("X-Finished") != "yes" {
			return fmt.Errorf("incorrect H3 response: status=%d proto=%s body=%q trailers=%v", resp.StatusCode, resp.Proto, body, resp.Trailer)
		}
		if resp.TLS == nil || !bytes.Equal(resp.TLS.VerifiedChains[0][1].Raw, mustCertificate(t, identity)) {
			return fmt.Errorf("client did not verify interception CA")
		}
		return nil
	}
	if err := request("/binary", []byte{0, 1, 127, 255}); err != nil {
		t.Fatal(err)
	}
	message := <-requestSeen
	if message["request"].(map[string]any)["httpVersion"] != "3.0" {
		t.Fatal("lost HTTP/3 request version")
	}
	socket := message["socket"].(map[string]any)
	if socket["remotePort"] != float64(source.Port()) || socket["remoteAddress"] != "127.0.0.1" {
		t.Fatalf("lost source: %v", socket)
	}
	if (<-responseSeen)["response"].(map[string]any)["httpVersion"] != "3.0" {
		t.Fatal("lost upstream HTTP/3 version")
	}
	if got := <-originReceived; !bytes.Equal(got, []byte{'e', 'd', 'i', 't', 'e', 'd', ':', 0, 1, 127, 255}) {
		t.Fatalf("request edit not applied: %q", got)
	}
	blocked := make(chan error, 1)
	go func() { blocked <- request("/paused", []byte("first")) }()
	select {
	case <-paused:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if err := request("/independent", []byte("second")); err != nil {
		t.Fatal(err)
	}
	close(resume)
	if err := <-blocked; err != nil {
		t.Fatal(err)
	}
	_ = transport.Close()
	select {
	case <-serveDone:
	case <-ctx.Done():
		t.Fatal("HTTP/3 flow leaked")
	}
	_ = engine.Close()
	<-controlDone
}

func mustCertificate(t *testing.T, identity ipc.Identity) []byte {
	t.Helper()
	block, _ := pem.Decode([]byte(identity.Certificate))
	if block == nil {
		t.Fatal("invalid test identity")
	}
	return block.Bytes
}
