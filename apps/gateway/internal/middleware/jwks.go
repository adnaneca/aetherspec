package middleware

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWKSProvider fetches and caches Keycloak's JWKS (JSON Web Key Set).
// It refreshes keys on demand when a kid is missing and periodically every 15 minutes.
type JWKSProvider struct {
	jwksURL  string
	audience string
	issuer   string
	keys     map[string]*rsa.PublicKey
	lastFetch time.Time
	mu       sync.RWMutex
	client   *http.Client
}

// jwk represents the subset of a JSON Web Key we need for RSA signatures.
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksResponse struct {
	Keys []jwk `json:"keys"`
}

// NewJWKSProvider creates a new JWKS provider for the given Keycloak realm.
func NewJWKSProvider(jwksURL, audience, issuer string) *JWKSProvider {
	return &JWKSProvider{
		jwksURL:  jwksURL,
		audience: audience,
		issuer:   issuer,
		keys:     make(map[string]*rsa.PublicKey),
	client:   &http.Client{Timeout: 5 * time.Second},
}
}

// fetchJWKS downloads and parses the JWKS endpoint, caching all RSA signing keys.
func (p *JWKSProvider) fetchJWKS() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.jwksURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create JWKS request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("failed to decode JWKS: %w", err)
	}

	newKeys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, key := range jwks.Keys {
		if key.Kty != "RSA" {
			continue
		}
		if key.Use != "" && key.Use != "sig" {
			continue
		}
		pub, err := decodeRSAPublicKey(key.N, key.E)
		if err != nil {
			continue
		}
		newKeys[key.Kid] = pub
	}

	p.keys = newKeys
	p.lastFetch = time.Now()

	return nil
}

// decodeRSAPublicKey builds an *rsa.PublicKey from base64url-encoded n and e.
func decodeRSAPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, fmt.Errorf("decode n: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, fmt.Errorf("decode e: %w", err)
	}

	n := new(big.Int).SetBytes(nBytes)
	e := int(new(big.Int).SetBytes(eBytes).Int64())
	if e == 0 {
		return nil, fmt.Errorf("invalid exponent")
	}

	return &rsa.PublicKey{N: n, E: e}, nil
}

// GetKey returns the public key for the token's kid header.
// It refreshes the JWKS if no key is cached or if the requested kid is missing.
func (p *JWKSProvider) GetKey(token *jwt.Token) (interface{}, error) {
	kid, ok := token.Header["kid"].(string)
	if !ok {
		return nil, fmt.Errorf("token missing kid header")
	}

	p.mu.RLock()
	key := p.keys[kid]
	needsRefresh := key == nil || time.Since(p.lastFetch) > 15*time.Minute
	p.mu.RUnlock()

	if needsRefresh {
		p.mu.Lock()
		defer p.mu.Unlock()

		// Recheck after acquiring write lock.
		key = p.keys[kid]
		if key != nil && time.Since(p.lastFetch) <= 15*time.Minute {
			return key, nil
		}

		if err := p.fetchJWKS(); err != nil {
			return nil, err
		}

		key = p.keys[kid]
		if key == nil {
			return nil, fmt.Errorf("key not found for kid: %s", kid)
		}
	}

	return key, nil
}
