package ipc

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const chunkSize = 64 * 1024
const maxMessage = 144 * 1024 * 1024

type Bytes []byte

func (b Bytes) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]string{"$bytes": base64.StdEncoding.EncodeToString(b)})
}

func (b *Bytes) UnmarshalJSON(data []byte) error {
	var value struct {
		Bytes string `json:"$bytes"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("decode binary IPC value: %w", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(value.Bytes)
	if err != nil {
		return fmt.Errorf("decode IPC base64: %w", err)
	}
	*b = decoded
	return nil
}

type Identity struct {
	Certificate string `json:"certificate"`
	Key         string `json:"key"`
}

type RequestOptions struct {
	Method   string          `json:"method"`
	URL      string          `json:"url"`
	Headers  map[string]any  `json:"headers"`
	CA       json.RawMessage `json:"ca"`
	Cert     json.RawMessage `json:"cert"`
	Key      json.RawMessage `json:"key"`
	Insecure bool            `json:"insecure,omitempty"`
}

type Message struct {
	Session       string         `json:"session,omitempty"`
	Type          string         `json:"type"`
	ID            string         `json:"id,omitempty"`
	Stream        string         `json:"stream,omitempty"`
	Data          Bytes          `json:"data,omitempty"`
	Trailers      map[string]any `json:"trailers,omitempty"`
	Error         string         `json:"error,omitempty"`
	Host          string         `json:"host,omitempty"`
	Port          int            `json:"port,omitempty"`
	IngressPort   int            `json:"ingressPort,omitempty"`
	Root          *Identity      `json:"root,omitempty"`
	Identity      *Identity      `json:"identity,omitempty"`
	URL           string         `json:"url,omitempty"`
	Route         string         `json:"route,omitempty"`
	Options       RequestOptions `json:"options,omitempty"`
	Local         bool           `json:"local,omitempty"`
	Inspect       bool           `json:"inspect,omitempty"`
	Status        int            `json:"status,omitempty"`
	StatusMessage string         `json:"statusMessage,omitempty"`
	Headers       map[string]any `json:"headers,omitempty"`
	Binary        bool           `json:"binary,omitempty"`
}

func ReadMessage(reader io.Reader) (Message, error) {
	var head [4]byte
	if _, err := io.ReadFull(reader, head[:]); err != nil {
		return Message{}, fmt.Errorf("read IPC header: %w", err)
	}
	size := binary.BigEndian.Uint32(head[:])
	if size == 0 || size > maxMessage {
		return Message{}, errors.New("invalid IPC frame length")
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return Message{}, fmt.Errorf("read IPC body: %w", err)
	}
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return Message{}, fmt.Errorf("decode IPC message: %w", err)
	}
	return msg, nil
}
