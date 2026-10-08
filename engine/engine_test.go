package engine

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/fqix/tapline/engine/internal/ipc"
)

func testIdentity(t *testing.T) ipc.Identity {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Tapline test CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true,
		BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	cert, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return ipc.Identity{Certificate: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert})),
		Key: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}))}
}

func readControl(reader io.Reader) (map[string]any, error) {
	var size uint32
	if err := binary.Read(reader, binary.BigEndian, &size); err != nil {
		return nil, err
	}
	if size > 1<<20 {
		return nil, errors.New("unexpected control frame size")
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	var message map[string]any
	err := json.Unmarshal(data, &message)
	return message, err
}

func TestEngineHTTPAndHTTPSOverMemory(t *testing.T) {
	for _, test := range []struct {
		name, destination, serverName string
	}{
		{"http", "example.com:443", ""},
		{"tls-domain", "example.com:443", "example.com"},
		{"tls-ip-with-sni", "127.0.0.1:443", "example.com"},
		{"tls-ip-without-sni", "127.0.0.1:443", "127.0.0.1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			encrypted := test.serverName != ""
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			in, writer := io.Pipe()
			reader, out := io.Pipe()
			engine := NewEngine(ctx, in, out)
			defer engine.Close()
			defer writer.Close()
			defer reader.Close()
			controller := ipc.NewPeer(writer, cancel)
			identity := testIdentity(t)
			if err := controller.Send(ipc.Message{Type: "start", Root: &identity, IngressPort: 6060}); err != nil {
				t.Fatal(err)
			}
			ready, err := readControl(reader)
			if err != nil || ready["type"] != "ready" || ready["in_process"] != true {
				t.Fatalf("ready=%v err=%v", ready, err)
			}
			observed := make(chan map[string]any, 1)
			policyDone := make(chan error, 1)
			go func() {
				for {
					message, err := readControl(reader)
					if err != nil {
						policyDone <- err
						return
					}
					id, _ := message["id"].(string)
					switch message["type"] {
					case "connect":
						err = controller.Send(map[string]any{"type": "inspect", "id": id})
					case "certificate":
						err = controller.Send(map[string]any{"type": "certificate-result", "id": id})
					case "request":
						observed <- message
						err = controller.Send(ipc.Message{Type: "request-result", ID: id, Local: true, Status: 200, Headers: map[string]any{"content-type": "text/plain"}})
						if err == nil {
							err = controller.Send(ipc.Message{Type: "chunk", Stream: id + ":request:out", Data: []byte("inspected")})
						}
					case "credit":
						stream, _ := message["stream"].(string)
						if strings.HasSuffix(stream, ":request:out") {
							err = controller.Send(ipc.Message{Type: "end", Stream: stream})
						}
					}
					if err != nil {
						policyDone <- err
						return
					}
				}
			}()
			source := netip.MustParseAddrPort("127.0.0.1:32123")
			conn, err := engine.DialContext(ctx, source, test.destination, !encrypted)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			if err = conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
				t.Fatal(err)
			}
			if encrypted {
				roots := x509.NewCertPool()
				roots.AppendCertsFromPEM([]byte(identity.Certificate))
				client := tls.Client(conn, &tls.Config{RootCAs: roots, ServerName: test.serverName, MinVersion: tls.VersionTLS12})
				if err = client.HandshakeContext(ctx); err != nil {
					t.Fatal(err)
				}
				conn = client
			}
			if _, err = io.WriteString(conn, "GET http://example.com/test HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\nX-Tapline-Source: 1.2.3.4:9999\r\n\r\n"); err != nil {
				t.Fatal(err)
			}
			response, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: "GET"})
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil || string(data) != "inspected" || response.StatusCode != 200 {
				t.Fatalf("response=%q status=%d err=%v", data, response.StatusCode, err)
			}
			message := <-observed
			socket := message["socket"].(map[string]any)
			if socket["remoteAddress"] != "127.0.0.1" || socket["remotePort"] != float64(32123) || socket["localPort"] != float64(6060) {
				t.Fatalf("source lost or spoofed: %v", socket)
			}
			writer.Close()
			if err = engine.Wait(); err != nil {
				t.Fatal(err)
			}
			<-policyDone
		})
	}
}

func TestEngineCloseUnblocksStartupAndDial(t *testing.T) {
	in, writer := io.Pipe()
	reader, out := io.Pipe()
	defer writer.Close()
	defer reader.Close()
	engine := NewEngine(t.Context(), in, out)
	result := make(chan error, 1)
	go func() {
		_, err := engine.DialContext(t.Context(), netip.MustParseAddrPort("127.0.0.1:32123"), "example.com:443", false)
		result <- err
	}()
	engine.Close()
	select {
	case err := <-result:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("dial did not stop")
	}
}

func TestEngineRejectsInvalidStart(t *testing.T) {
	in, writer := io.Pipe()
	reader, out := io.Pipe()
	defer writer.Close()
	defer reader.Close()
	engine := NewEngine(t.Context(), in, out)
	defer engine.Close()
	controller := ipc.NewPeer(writer, func() {})
	if err := controller.Send(ipc.Message{Type: "start"}); err != nil {
		t.Fatal(err)
	}
	if err := engine.Wait(); err == nil {
		t.Fatal("missing CA was accepted")
	}
}

func TestIngressRequiresInProcessIdentity(t *testing.T) {
	r := &runtime{}
	req := &http.Request{RemoteAddr: "peer", Header: make(http.Header)}
	req.Header.Set("X-Tapline-Token", "in-process")
	req.Header.Set("X-Tapline-Source", "127.0.0.1:12345")
	if r.hasIngress(req) {
		t.Fatal("HTTP headers authorized an untracked connection")
	}
	tracked := &trackedConn{}
	r.connections.Store("peer", tracked)
	if r.hasIngress(req) {
		t.Fatal("connection without source identity was accepted")
	}
	tracked.ingressSource.Store(&net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 12345})
	if !r.hasIngress(req) {
		t.Fatal("in-process identity rejected")
	}
	quic := req.WithContext(context.WithValue(t.Context(), quicSourceKey{}, netip.MustParseAddrPort("127.0.0.1:54321")))
	quic.RemoteAddr = "untracked QUIC"
	if !r.hasIngress(quic) {
		t.Fatal("routed QUIC identity rejected")
	}
}
