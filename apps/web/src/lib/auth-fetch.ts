// This module provides a fetch wrapper that automatically injects
// the Keycloak JWT Bearer token into every API request.
//
// Design decisions:
// - The authoritative source of the current token is the Keycloak adapter.
// - A synchronous fallback token is kept for code that initializes before the
//   adapter is ready.
// - The 401 handler redirects to login; it does NOT retry the request, avoiding
//   thundering-herd refresh attempts.

let authToken: string | null = null;
let authTokenGetter: (() => Promise<string | null>) | null = null;
let onTokenExpired: (() => void) | null = null;

// Legacy synchronous setter used during init and by non-fetch code.
export function setAuthToken(token: string | null) {
  authToken = token;
}

// Register an async getter that returns the current (possibly refreshed) token.
// The provider should call kc.updateToken() inside this getter when needed.
export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  authTokenGetter = getter;
}

// Called once during app initialization to register the 401 handler.
export function setOnTokenExpired(handler: () => void) {
  onTokenExpired = handler;
}

async function getAuthToken(): Promise<string | null> {
  if (authTokenGetter) {
    return authTokenGetter();
  }
  return authToken;
}

// Drop-in replacement for fetch() that adds Authorization header.
export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  const token = await getAuthToken();

  // Inject Bearer token if available.
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Set Content-Type for JSON bodies (unless FormData).
  if (
    !headers.has("Content-Type") &&
    options.body &&
    !(options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  const resp = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  // Handle 401 — token may be expired. Delegate to the registered handler.
  if (resp.status === 401 && onTokenExpired) {
    onTokenExpired();
  }

  return resp;
}

// SSE-specific fetch that also includes the Bearer token.
// (SSE uses ReadableStream, so we need a separate function.)
export async function authFetchStream(
  url: string,
  body: any,
): Promise<ReadableStream<Uint8Array>> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  });

  if (resp.status === 401 && onTokenExpired) {
    onTokenExpired();
  }

  if (!resp.ok) {
    throw new Error(`Request failed: ${resp.status}`);
  }

  if (!resp.body) {
    throw new Error("No stream received");
  }

  return resp.body;
}
