package upstream

import (
	"encoding/json"
	"encoding/pem"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/fqix/tapline/engine/internal/ipc"
)

func TestHTTPSProxyVerificationIsIndependentOfOrigin(t *testing.T) {
	proxy := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
	}))
	proxy.Config.ErrorLog = log.New(io.Discard, "", 0)
	proxy.StartTLS()
	defer proxy.Close()
	for _, trusted := range []bool{false, true} {
		for _, connect := range []bool{false, true} {
			name := "http"
			if connect {
				name = "connect"
			}
			if trusted {
				name += "-trusted"
			} else {
				name += "-untrusted"
			}
			t.Run(name, func(t *testing.T) {
				options := ipc.RequestOptions{Insecure: true}
				if trusted {
					certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: proxy.Certificate().Raw})
					options.CA, _ = json.Marshal(string(certificate))
				}
				if connect {
					config, err := upstreamTLS(options)
					if err != nil {
						t.Fatal(err)
					}
					address, _ := url.Parse(proxy.URL)
					dialer := &net.Dialer{}
					transport := &http.Transport{Proxy: http.ProxyURL(address), TLSClientConfig: config, DialContext: dialer.DialContext}
					conn, err := connectHTTPProxy(t.Context(), transport, "origin.invalid:443")
					if conn != nil {
						conn.Close()
					}
					if trusted && err != nil {
						t.Fatal(err)
					}
					if !trusted && err == nil {
						t.Fatal("insecure origin policy trusted an untrusted HTTPS proxy")
					}
					if !config.InsecureSkipVerify {
						t.Fatal("origin policy was mutated")
					}
				} else {
					pool := &Pool{}
					defer pool.Close()
					transport, err := pool.Get(options, proxy.URL, false, false)
					if err != nil {
						t.Fatal(err)
					}
					request, _ := http.NewRequestWithContext(t.Context(), "GET", "http://origin.invalid/", nil)
					response, err := transport.RoundTrip(request)
					if response != nil {
						response.Body.Close()
					}
					if trusted && err != nil {
						t.Fatal(err)
					}
					if !trusted && err == nil {
						t.Fatal("insecure origin policy trusted an untrusted HTTPS proxy")
					}
				}
			})
		}
	}
}
