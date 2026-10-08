package engine

import "context"

type (
	inboundControlKey struct{}
	inboundTagKey     struct{}
)

// InboundControl changes window listeners on the host proxy.
type InboundControl func(action, tag string, port int) (int, error)

func WithInboundControl(ctx context.Context, handler InboundControl) context.Context {
	return context.WithValue(ctx, inboundControlKey{}, handler)
}

// InboundTag names the window inlet that accepted the connection carried by ctx.
type InboundTag func(ctx context.Context) string

func WithInboundTag(ctx context.Context, lookup InboundTag) context.Context {
	return context.WithValue(ctx, inboundTagKey{}, lookup)
}

// inboundOf resolves the inlet tag through the host's lookup, if it installed one.
// The engine reads the lookup from its own parent context, not the caller's.
func (e *Engine) inboundOf(ctx context.Context) string {
	if lookup, ok := e.ctx.Value(inboundTagKey{}).(InboundTag); ok {
		return lookup(ctx)
	}
	return ""
}
