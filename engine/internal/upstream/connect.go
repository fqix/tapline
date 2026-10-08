package upstream

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"
)

type bufferedConn struct {
	net.Conn
	reader io.Reader
}

func (c *bufferedConn) Read(data []byte) (int, error) { return c.reader.Read(data) }

func connectHTTPProxy(ctx context.Context, transport *http.Transport, target string) (net.Conn, error) {
	proxyURL, err := transport.Proxy(&http.Request{URL: &url.URL{Scheme: "http", Host: target}})
	if err != nil {
		return nil, err
	}
	address := proxyURL.Host
	if proxyURL.Port() == "" {
		port := "80"
		if proxyURL.Scheme == "https" {
			port = "443"
		}
		address = net.JoinHostPort(proxyURL.Hostname(), port)
	}
	conn, err := transport.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			closeQuietly(conn)
		}
	}()
	stop := context.AfterFunc(ctx, func() { closeQuietly(conn) })
	defer stop()
	if err := conn.SetDeadline(time.Now().Add(15 * time.Second)); err != nil {
		return nil, err
	}
	if proxyURL.Scheme == "https" {
		config := transport.TLSClientConfig.Clone()
		config.ServerName = proxyURL.Hostname()
		// Origin verification policy must never disable proxy authentication.
		config.InsecureSkipVerify = false
		secure := tls.Client(conn, config)
		if err := secure.HandshakeContext(ctx); err != nil {
			return nil, err
		}
		conn = secure
	}
	req := &http.Request{Method: http.MethodConnect, URL: &url.URL{Opaque: target}, Host: target, Header: make(http.Header)}
	if proxyURL.User != nil {
		password, _ := proxyURL.User.Password()
		req.SetBasicAuth(proxyURL.User.Username(), password)
		req.Header.Set("Proxy-Authorization", req.Header.Get("Authorization"))
		req.Header.Del("Authorization")
	}
	if err := req.Write(conn); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream CONNECT returned %d", response.StatusCode)
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		return nil, err
	}
	ok = true
	return &bufferedConn{Conn: conn, reader: reader}, nil
}
