import type { AdminSettingsConfig } from '../types';

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
