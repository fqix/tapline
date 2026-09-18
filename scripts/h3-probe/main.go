// h3-probe sends HTTP/3 requests through Tapline's SOCKS5 UDP ASSOCIATE so QUIC
// traffic shows up in the panel. curl, Chrome and most clients refuse to run
// HTTP/3 over a proxy, so a small quic-go client is the simplest end-to-end test.
//
//	go run . [-proxy 127.0.0.1:3606] [-ca $SSL_CERT_FILE] URL...
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
)

func main() {
	proxy := flag.String("proxy", envOr("TAPLINE_PROXY", "127.0.0.1:3606"), "SOCKS5 proxy host:port (Tapline's mixed listener)")
	caFile := flag.String("ca", envOr("SSL_CERT_FILE", ""), "PEM file with the Tapline root CA")
	insecure := flag.Bool("insecure", false, "skip TLS verification")
	timeout := flag.Duration("timeout", 20*time.Second, "per-request timeout")
	flag.Parse()
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: h3-probe [-proxy host:port] [-ca file] URL...")
		os.Exit(2)
	}

	tlsConf := &tls.Config{InsecureSkipVerify: *insecure, NextProtos: []string{http3.NextProtoH3}}
	if *caFile != "" {
		pem, err := os.ReadFile(*caFile)
		if err != nil {
			fmt.Fprintln(os.Stderr, "ca:", err)
			os.Exit(1)
		}
		pool, _ := x509.SystemCertPool()
		if pool == nil {
			pool = x509.NewCertPool()
		}
		pool.AppendCertsFromPEM(pem)
		tlsConf.RootCAs = pool
	}

	transport := &http3.Transport{
		TLSClientConfig: tlsConf,
		Dial: func(ctx context.Context, addr string, tlsCfg *tls.Config, cfg *quic.Config) (*quic.Conn, error) {
			pconn, remote, err := socks5UDP(ctx, *proxy, addr)
			if err != nil {
				return nil, err
			}
			conn, err := quic.Dial(ctx, pconn, remote, tlsCfg, cfg)
			if err != nil {
				pconn.Close()
				return nil, err
			}
			return conn, nil
		},
	}
	defer transport.Close()
	client := &http.Client{Transport: transport, Timeout: *timeout}

	failed := 0
	for _, url := range flag.Args() {
		start := time.Now()
		resp, err := client.Get(url)
		if err != nil {
			fmt.Printf("  %-50s FAIL %v\n", url, err)
			failed++
			continue
		}
		n, _ := io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		fmt.Printf("  %-50s %s %d  %6d bytes  %s\n", url, resp.Proto, resp.StatusCode, n, time.Since(start).Round(time.Millisecond))
	}
	if failed > 0 {
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// socks5UDP opens a SOCKS5 UDP ASSOCIATE session and returns a PacketConn that
// speaks plain datagrams to target (host:port) with the SOCKS header added and
// stripped transparently, plus the resolved remote address quic-go should dial.
func socks5UDP(ctx context.Context, proxy, target string) (net.PacketConn, *net.UDPAddr, error) {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return nil, nil, err
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, nil, fmt.Errorf("resolve %s: %w", host, err)
	}
	remote, err := net.ResolveUDPAddr("udp", net.JoinHostPort(ips[0].String(), port))
	if err != nil {
		return nil, nil, err
	}

	// The TCP control connection must stay open for the lifetime of the association.
	control, err := (&net.Dialer{}).DialContext(ctx, "tcp", proxy)
	if err != nil {
		return nil, nil, fmt.Errorf("proxy %s: %w", proxy, err)
	}
	fail := func(err error) (net.PacketConn, *net.UDPAddr, error) {
		control.Close()
		return nil, nil, err
	}
	control.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err := control.Write([]byte{5, 1, 0}); err != nil { // VER, NMETHODS, NO AUTH
		return fail(err)
	}
	var reply [4]byte
	if _, err := io.ReadFull(control, reply[:2]); err != nil || reply[0] != 5 || reply[1] != 0 {
		return fail(fmt.Errorf("socks5 greeting rejected: %v %v", reply[:2], err))
	}
	// UDP ASSOCIATE with an unspecified client address: the proxy relays whatever
	// arrives on the returned port.
	if _, err := control.Write([]byte{5, 3, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		return fail(err)
	}
	if _, err := io.ReadFull(control, reply[:]); err != nil {
		return fail(err)
	}
	if reply[1] != 0 {
		return fail(fmt.Errorf("udp associate refused: reply code %d", reply[1]))
	}
	var bindIP net.IP
	switch reply[3] {
	case 1:
		buf := make([]byte, 4)
		if _, err := io.ReadFull(control, buf); err != nil {
			return fail(err)
		}
		bindIP = net.IP(buf)
	case 4:
		buf := make([]byte, 16)
		if _, err := io.ReadFull(control, buf); err != nil {
			return fail(err)
		}
		bindIP = net.IP(buf)
	case 3:
		var n [1]byte
		if _, err := io.ReadFull(control, n[:]); err != nil {
			return fail(err)
		}
		name := make([]byte, n[0])
		if _, err := io.ReadFull(control, name); err != nil {
			return fail(err)
		}
		addrs, err := net.LookupIP(string(name))
		if err != nil || len(addrs) == 0 {
			return fail(fmt.Errorf("resolve relay %q: %v", name, err))
		}
		bindIP = addrs[0]
	default:
		return fail(fmt.Errorf("unknown ATYP %d", reply[3]))
	}
	var bindPort [2]byte
	if _, err := io.ReadFull(control, bindPort[:]); err != nil {
		return fail(err)
	}
	control.SetDeadline(time.Time{})
	if bindIP.IsUnspecified() {
		proxyHost, _, _ := net.SplitHostPort(proxy)
		bindIP = net.ParseIP(proxyHost)
	}
	relay := &net.UDPAddr{IP: bindIP, Port: int(binary.BigEndian.Uint16(bindPort[:]))}

	udp, err := net.ListenUDP("udp", nil)
	if err != nil {
		return fail(err)
	}
	return &socksPacketConn{UDPConn: udp, control: control, relay: relay, remote: remote}, remote, nil
}

// socksPacketConn frames datagrams for the SOCKS5 UDP relay: every packet gets
// a header naming the target, and incoming packets have it removed.
type socksPacketConn struct {
	*net.UDPConn
	control net.Conn
	relay   *net.UDPAddr
	remote  *net.UDPAddr
	header  []byte
}

func (c *socksPacketConn) WriteTo(p []byte, _ net.Addr) (int, error) {
	if c.header == nil {
		c.header = socksHeader(c.remote)
	}
	buf := make([]byte, 0, len(c.header)+len(p))
	buf = append(buf, c.header...)
	buf = append(buf, p...)
	if _, err := c.UDPConn.WriteTo(buf, c.relay); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *socksPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	buf := make([]byte, len(p)+262)
	for {
		n, _, err := c.UDPConn.ReadFrom(buf)
		if err != nil {
			return 0, nil, err
		}
		body, ok := stripSocksHeader(buf[:n])
		if !ok {
			continue
		}
		return copy(p, body), c.remote, nil
	}
}

func (c *socksPacketConn) Close() error {
	c.control.Close()
	return c.UDPConn.Close()
}

func socksHeader(a *net.UDPAddr) []byte {
	h := []byte{0, 0, 0}
	if ip4 := a.IP.To4(); ip4 != nil {
		h = append(h, 1)
		h = append(h, ip4...)
	} else {
		h = append(h, 4)
		h = append(h, a.IP.To16()...)
	}
	return binary.BigEndian.AppendUint16(h, uint16(a.Port))
}

func stripSocksHeader(b []byte) ([]byte, bool) {
	if len(b) < 4 || b[2] != 0 { // fragmented datagrams are not supported
		return nil, false
	}
	var n int
	switch b[3] {
	case 1:
		n = 4 + 4 + 2
	case 4:
		n = 4 + 16 + 2
	case 3:
		if len(b) < 5 {
			return nil, false
		}
		n = 4 + 1 + int(b[4]) + 2
	default:
		return nil, false
	}
	if len(b) < n {
		return nil, false
	}
	return b[n:], true
}

