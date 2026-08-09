// This module provides a fetch wrapper that automatically injects
// the Keycloak JWT Bearer token into every API request.
//
// Design decisions:
// - Token refresh is handled ONLY by the Keycloak provider (onTokenExpired).
// - The 401 handler here only redirects to login; it does NOT attempt refresh,
//   avoiding duplicate refresh logic and thundering-herd refresh attempts.

let authToken: string | null = null;
let onTokenExpired: (() => void) | null = null;

// Called by the Keycloak provider whenever the token changes/refreshes.
export function setAuthToken(token: string | null) {
  authToken = token;
}

// Called once during app initialization to register the 401 handler.
export function setOnTokenExpired(handler: () => void) {
  onTokenExpired = handler;
}

// Drop-in replacement for fetch() that adds Authorization header.
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);

  // Inject Bearer token if available.
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  // Set Content-Type for JSON bodies (unless FormData).
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const resp = await fetch(url, { ...options, headers, credentials: 'include' });

  // Handle 401 — token may be expired. Delegate to the registered handler.
  if (resp.status === 401 && onTokenExpired) {
    onTokenExpired();
  }

  return resp;
}

// SSE-specific fetch that also includes the Bearer token.
// (SSE uses ReadableStream, so we need a separate function.)
export async function authFetchStream(url: string, body: any): Promise<ReadableStream<Uint8Array>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (resp.status === 401 && onTokenExpired) {
    onTokenExpired();
  }

  if (!resp.ok) {
    throw new Error(`Request failed: ${resp.status}`);
  }

  if (!resp.body) {
    throw new Error('No stream received');
  }

  return resp.body;
}
