package ipc

import (
	"fmt"
	"net/http"
	"strings"
)

func HTTPHeaders(values map[string]any) http.Header {
	result := make(http.Header)
	for name, value := range values {
		switch value := value.(type) {
		case string:
			result.Add(name, value)
		case []any:
			for _, item := range value {
				result.Add(name, fmt.Sprint(item))
			}
		case []string:
			for _, item := range value {
				result.Add(name, item)
			}
		case float64:
			result.Add(name, fmt.Sprint(value))
		}
	}
	return result
}

func NodeHeaders(values http.Header) map[string]any {
	result := make(map[string]any, len(values))
	for name, parts := range values {
		if len(parts) == 1 && !strings.EqualFold(name, "Set-Cookie") {
			result[strings.ToLower(name)] = parts[0]
		} else {
			result[strings.ToLower(name)] = append([]string{}, parts...)
		}
	}
	return result
}
