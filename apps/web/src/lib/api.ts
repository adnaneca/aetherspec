import type { AdminSettingsConfig, AdminProvider, UserSettingsConfig, SDLCProject, Document, DocumentStep } from '../types';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_API_URL || 'http://localhost:3000';

export async function getAdminConfig(): Promise<AdminSettingsConfig> {
  const resp = await fetch(`${GATEWAY_URL}/api/admin/config`);
  if (!resp.ok) throw new Error(`Failed to fetch admin config: ${resp.status}`);
  return resp.json();
}

export async function saveAdminConfig(config: AdminSettingsConfig): Promise<{ status: string }> {
  const resp = await fetch(`${GATEWAY_URL}/api/admin/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json' },
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
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify(settings),
  });
  if (!resp.ok) throw new Error(`Failed to save user settings: ${resp.status}`);
  return resp.json();
}

// ── Projects API (TMF-compliant paths) ──

export async function getProjects(): Promise<SDLCProject[]> {
  const resp = await fetch(`${GATEWAY_URL}/api/project`);
  if (!resp.ok) throw new Error(`Failed to fetch projects: ${resp.status}`);
  return resp.json();
}

export async function getProject(id: string): Promise<SDLCProject> {
  const resp = await fetch(`${GATEWAY_URL}/api/project/${id}`);
  if (!resp.ok) throw new Error(`Failed to fetch project: ${resp.status}`);
  return resp.json();
}

export async function createProject(data: {
  name: string;
  key: string;
  description: string;
  targetDate: string;
}): Promise<SDLCProject> {
  const resp = await fetch(`${GATEWAY_URL}/api/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`Failed to create project: ${resp.status}`);
  return resp.json();
}

export async function patchProject(id: string, patch: Partial<SDLCProject>): Promise<SDLCProject> {
  const resp = await fetch(`${GATEWAY_URL}/api/project/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`Failed to update project: ${resp.status}`);
  return resp.json();
}

export async function deleteProject(id: string): Promise<void> {
  const resp = await fetch(`${GATEWAY_URL}/api/project/${id}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`Failed to delete project: ${resp.status}`);
}

export async function getDocuments(projectId: string, docType?: string): Promise<Document[]> {
  const params = new URLSearchParams();
  params.set('projectId', projectId);
  if (docType) params.set('docType', docType);
  const resp = await fetch(`${GATEWAY_URL}/api/document?${params.toString()}`);
  if (!resp.ok) throw new Error(`Failed to fetch documents: ${resp.status}`);
  return resp.json();
}

export async function getDocumentSteps(docId: string): Promise<DocumentStep[]> {
  const resp = await fetch(`${GATEWAY_URL}/api/document/${docId}/step`);
  if (!resp.ok) throw new Error(`Failed to fetch document steps: ${resp.status}`);
  return resp.json();
}

export async function getStepContent(docId: string, stepId: number): Promise<DocumentStep> {
  const resp = await fetch(`${GATEWAY_URL}/api/document/${docId}/step/${stepId}`);
  if (!resp.ok) throw new Error(`Failed to fetch step content: ${resp.status}`);
  return resp.json();
}

export async function patchStep(docId: string, stepId: number, patch: { content?: string; status?: string }): Promise<DocumentStep> {
  const resp = await fetch(`${GATEWAY_URL}/api/document/${docId}/step/${stepId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`Failed to save step content: ${resp.status}`);
  return resp.json();
}

export async function approveStep(docId: string, stepId: number): Promise<{ status: string; nextStep: number }> {
  const resp = await fetch(`${GATEWAY_URL}/api/document/${docId}/step/${stepId}/approve`, {
    method: 'POST',
  });
  if (!resp.ok) throw new Error(`Failed to approve step: ${resp.status}`);
  return resp.json();
}

export async function createDocument(data: { projectId: string; docType: string; totalSteps?: number }): Promise<Document> {
  const resp = await fetch(`${GATEWAY_URL}/api/document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`Failed to create document: ${resp.status}`);
  return resp.json();
}

export interface Attachment {
  id: string;
  projectId: string;
  name: string;
  mimeType?: string;
  size?: number;
  folder: string;
  minioPath: string;
  href: string;
  revision?: number;
}

export async function getAttachments(projectId: string): Promise<Attachment[]> {
  const resp = await fetch(`${GATEWAY_URL}/api/attachment?projectId=${encodeURIComponent(projectId)}`);
  if (!resp.ok) throw new Error(`Failed to fetch attachments: ${resp.status}`);
  return resp.json();
}

export async function downloadAttachment(
  attachmentId: string,
  metadata?: { name?: string; mimeType?: string }
): Promise<{ content: string; name: string; mimeType?: string }> {
  const resp = await fetch(`${GATEWAY_URL}/api/attachment/${encodeURIComponent(attachmentId)}`);
  if (!resp.ok) throw new Error(`Failed to download attachment: ${resp.status}`);
  const headerName = resp.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1];
  const name = metadata?.name || headerName || 'download';
  const content = await resp.text();
  return {
    content,
    name,
    mimeType: metadata?.mimeType || resp.headers.get('Content-Type') || undefined,
  };
}
