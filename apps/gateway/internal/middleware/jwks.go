package middleware

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// JWKSProvider fetches and caches Keycloak's JWKS (JSON Web Key Set).
// It uses keyfunc/v3, which handles background key rotation automatically.
type JWKSProvider struct {
	jwksURL  string
	audience string
	issuer   string
	keyfunc  keyfunc.Keyfunc
	mu       sync.RWMutex
}

// NewJWKSProvider creates a new JWKS provider for the given Keycloak realm.
func NewJWKSProvider(jwksURL, audience, issuer string) *JWKSProvider {
	return &JWKSProvider{
		jwksURL:  jwksURL,
		audience: audience,
		issuer:   issuer,
	}
}

// getKey returns the public key for the token's kid header.
// The first call fetches the JWKS; subsequent calls use the cached JWKS.
func (p *JWKSProvider) getKey(token *jwt.Token) (interface{}, error) {
	p.mu.RLock()
	needsInit := p.keyfunc == nil
	p.mu.RUnlock()

	if needsInit {
		p.mu.Lock()
		defer p.mu.Unlock()

		// Defensive: recheck inside the write lock.
		if p.keyfunc != nil {
			return p.keyfunc.Keyfunc(token)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		kf, err := keyfunc.NewDefaultCtx(ctx, []string{p.jwksURL})
		if err != nil {
			return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
		}
		p.keyfunc = kf
	}

	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.keyfunc.Keyfunc(token)
}
