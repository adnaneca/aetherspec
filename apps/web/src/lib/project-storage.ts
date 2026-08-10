const STORAGE_KEY = 'aetherspec.activeProjectId';

export function getStoredProjectId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredProjectId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}
