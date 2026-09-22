package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

func getBaseURL() string {
	if u := os.Getenv("HTTPBIN"); u != "" {
		return u
	}
	if u := os.Getenv("BASE_URL"); u != "" {
		return u
	}
	return "https://httpbin.org"
}

func newHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()

	// If SSL_CERT_FILE is set (e.g. injected by Tapline), load custom CA cert pool
	if caFile := os.Getenv("SSL_CERT_FILE"); caFile != "" {
		if pem, err := os.ReadFile(caFile); err == nil {
			pool, _ := x509.SystemCertPool()
			if pool == nil {
				pool = x509.NewCertPool()
			}
			pool.AppendCertsFromPEM(pem)
			if transport.TLSClientConfig == nil {
				transport.TLSClientConfig = &tls.Config{}
			}
			transport.TLSClientConfig.RootCAs = pool
		}
	}

	return &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
	}
}

func main() {
	baseURL := getBaseURL()
	client := newHTTPClient()
	ctx := context.Background()

	fmt.Printf("=== Running Go HTTP Client Examples (Base: %s) ===\n\n", baseURL)

	// 1. GET Request
	if err := runGet(ctx, client, baseURL); err != nil {
		fmt.Fprintf(os.Stderr, "GET error: %v\n", err)
	}

	// 2. POST Request (JSON)
	if err := runPost(ctx, client, baseURL); err != nil {
		fmt.Fprintf(os.Stderr, "POST error: %v\n", err)
	}

	// 3. DELETE Request
	if err := runDelete(ctx, client, baseURL); err != nil {
		fmt.Fprintf(os.Stderr, "DELETE error: %v\n", err)
	}

	fmt.Println("=== Finished Go HTTP Client Examples ===")
}

func runGet(ctx context.Context, client *http.Client, baseURL string) error {
	url := fmt.Sprintf("%s/get?lang=go&sample=tapline", baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "tapline-go-example/1.0")
	req.Header.Set("Accept", "application/json")

	fmt.Printf("--> GET %s\n", url)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("<-- %s (%d bytes)\n", resp.Status, len(body))
	printSnippet(body)
	fmt.Println()
	return nil
}

func runPost(ctx context.Context, client *http.Client, baseURL string) error {
	url := fmt.Sprintf("%s/post", baseURL)
	payload := map[string]any{
		"client":    "tapline-go",
		"action":    "create",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "tapline-go-example/1.0")

	fmt.Printf("--> POST %s (json body: %s)\n", url, string(data))
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("<-- %s (%d bytes)\n", resp.Status, len(body))
	printSnippet(body)
	fmt.Println()
	return nil
}

func runDelete(ctx context.Context, client *http.Client, baseURL string) error {
	url := fmt.Sprintf("%s/delete?id=42", baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "tapline-go-example/1.0")
	req.Header.Set("Accept", "application/json")

	fmt.Printf("--> DELETE %s\n", url)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("<-- %s (%d bytes)\n", resp.Status, len(body))
	printSnippet(body)
	fmt.Println()
	return nil
}

func printSnippet(b []byte) {
	if len(b) > 200 {
		fmt.Printf("    Body: %s...\n", string(b[:200]))
	} else {
		fmt.Printf("    Body: %s\n", string(b))
	}
}
