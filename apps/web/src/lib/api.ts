import type { AdminSettingsConfig, AdminProvider, UserSettingsConfig } from '../types';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_API_URL || 'http://localhost:3000';

export async function getAdminConfig(): Promise<AdminSettingsConfig> {
  const resp = await fetch(`${GATEWAY_URL}/api/admin/config`);
  if (!resp.ok) throw new Error(`Failed to fetch admin config: ${resp.status}`);
  return resp.json();
}

export async function saveAdminConfig(config: AdminSettingsConfig): Promise<{ status: string }> {
  const resp = await fetch(`${GATEWAY_URL}/api/admin/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!resp.ok) throw new Error(`Failed to save admin config: ${resp.status}`);
  return resp.json();
}

export interface OllamaModelCatalog {
  models?: Array<{ name: string }>;
}

export async function getOllamaModels(): Promise<OllamaModelCatalog> {
  const resp = await fetch(`${GATEWAY_URL}/api/admin/providers/ollama/models`);
  if (!resp.ok) throw new Error(`Failed to fetch Ollama models: ${resp.status}`);
  return resp.json();
}

export interface TestProviderResult {
  status: 'connected' | 'failed';
  reason?: string;
}

export async function testProvider(provider: AdminProvider): Promise<TestProviderResult> {
  const resp = await fetch(`${GATEWAY_URL}/api/admin/providers/${provider.id}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: provider.id,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
    }),
  });
  if (!resp.ok) throw new Error(`Provider test failed: ${resp.status}`);
  return resp.json();
}

export async function getUserSettings(): Promise<UserSettingsConfig> {
  const resp = await fetch(`${GATEWAY_URL}/api/user/settings`);
  if (!resp.ok) throw new Error(`Failed to fetch user settings: ${resp.status}`);
  return resp.json();
}

export async function saveUserSettings(settings: UserSettingsConfig): Promise<{ status: string }> {
  const resp = await fetch(`${GATEWAY_URL}/api/user/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!resp.ok) throw new Error(`Failed to save user settings: ${resp.status}`);
  return resp.json();
}
