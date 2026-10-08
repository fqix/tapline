package ipc

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
)

// Peer multiplexes policy replies and bounded body streams over inherited pipes.
// The reader never waits for a body consumer: a stream gets one chunk of credit,
// so a paused breakpoint cannot block cancellation or a different HTTP/2 stream.
type Peer struct {
	writer  io.Writer
	writeMu sync.Mutex
	mu      sync.Mutex
	pending map[string]chan Message
	readers map[string]*BodyReader
	credits map[string]chan struct{}
	fatal   context.CancelFunc
}

func NewPeer(writer io.Writer, fatal context.CancelFunc) *Peer {
	return &Peer{
		writer: writer, fatal: fatal,
		pending: make(map[string]chan Message),
		readers: make(map[string]*BodyReader),
		credits: make(map[string]chan struct{}),
	}
}

func (p *Peer) Send(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode IPC message: %w", err)
	}
	if len(data) > maxMessage {
		return errors.New("IPC message exceeds size limit")
	}
	frame := make([]byte, 4+len(data))
	binary.BigEndian.PutUint32(frame, uint32(len(data)))
	copy(frame[4:], data)
	p.writeMu.Lock()
	_, err = p.writer.Write(frame)
	p.writeMu.Unlock()
	if err != nil {
		p.fatal()
		return fmt.Errorf("write IPC message: %w", err)
	}
	return nil
}

func (p *Peer) Reply(key string) (<-chan Message, func()) {
	replies := make(chan Message, 1)
	p.mu.Lock()
	p.pending[key] = replies
	p.mu.Unlock()
	return replies, func() {
		p.mu.Lock()
		delete(p.pending, key)
		p.mu.Unlock()
	}
}

func (p *Peer) Ask(ctx context.Context, msg map[string]any) (Message, error) {
	key := fmt.Sprintf("%s-result:%s", msg["type"], msg["id"])
	replies, remove := p.Reply(key)
	defer remove()
	if err := p.Send(msg); err != nil {
		return Message{}, err
	}
	select {
	case <-ctx.Done():
		return Message{}, ctx.Err()
	case reply := <-replies:
		if reply.Error != "" {
			return Message{}, errors.New(reply.Error)
		}
		return reply, nil
	}
}

func (p *Peer) Receive(msg Message) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if msg.Stream == "" {
		if reply := p.pending[msg.Type+":"+msg.ID]; reply != nil {
			select {
			case reply <- msg:
			default:
				return errors.New("duplicate IPC reply")
			}
		}
		return nil
	}
	if msg.Type == "credit" {
		if credit := p.credits[msg.Stream]; credit != nil {
			select {
			case credit <- struct{}{}:
			default:
				return errors.New("duplicate IPC credit")
			}
		}
		return nil
	}
	if reader := p.readers[msg.Stream]; reader != nil {
		select {
		case <-reader.done:
		case reader.messages <- msg:
		default:
			return errors.New("IPC producer exceeded stream credit")
		}
	}
	return nil
}

func (p *Peer) RemoveStreams(prefix string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id := range p.readers {
		if strings.HasPrefix(id, prefix) {
			delete(p.readers, id)
		}
	}
}

// Fail cancels the runtime when its control channel or listener fails.
func (p *Peer) Fail() { p.fatal() }
