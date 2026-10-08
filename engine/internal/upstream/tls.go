package upstream

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/fqix/tapline/engine/internal/ipc"
)

func pemBytes(value json.RawMessage) ([]byte, error) {
	if len(value) == 0 || string(value) == "null" {
		return nil, nil
	}
	if value[0] == '"' {
		var text string
		if err := json.Unmarshal(value, &text); err != nil {
			return nil, fmt.Errorf("decode PEM string: %w", err)
		}
		return []byte(text), nil
	}
	if value[0] == '[' {
		var parts []json.RawMessage
		if err := json.Unmarshal(value, &parts); err != nil {
			return nil, fmt.Errorf("decode PEM chain: %w", err)
		}
		result := []byte{}
		for _, part := range parts {
			data, err := pemBytes(part)
			if err != nil {
				return nil, err
			}
			result = append(result, data...)
			result = append(result, '\n')
		}
		return result, nil
	}
	var data ipc.Bytes
	if err := json.Unmarshal(value, &data); err != nil {
		return nil, err
	}
	return data, nil
}

func upstreamTLS(options ipc.RequestOptions) (*tls.Config, error) {
	config := &tls.Config{MinVersion: tls.VersionTLS12}
	if options.Insecure {
		config.InsecureSkipVerify = true
	}
	ca, err := pemBytes(options.CA)
	if err != nil {
		return nil, err
	}
	if len(ca) > 0 {
		config.RootCAs = x509.NewCertPool()
		if !config.RootCAs.AppendCertsFromPEM(ca) {
			return nil, errors.New("invalid upstream CA certificate")
		}
	}
	cert, err := pemBytes(options.Cert)
	if err != nil {
		return nil, err
	}
	key, err := pemBytes(options.Key)
	if err != nil {
		return nil, err
	}
	if len(cert) > 0 || len(key) > 0 {
		identity, err := tls.X509KeyPair(cert, key)
		if err != nil {
			return nil, fmt.Errorf("load client identity: %w", err)
		}
		config.Certificates = []tls.Certificate{identity}
	}
	return config, nil
}
