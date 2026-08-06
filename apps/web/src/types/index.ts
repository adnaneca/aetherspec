export type ThemeName = 'default' | 'bank' | 'rental';

export type PersonaRole =
  | 'ba_lead'
  | 'business_analyst'
  | 'solution_architect'
  | 'tech_lead'
  | 'qa_lead'
  | 'scrum_master'
  | 'marketing_manager'
  | 'admin';

export interface Persona {
  id: PersonaRole;
  name: string;
  title: string;
  avatarUrl: string;
  keycloakRoles: string[];
  department: string;
}

export type DocType = 'brs' | 'srs' | 'testcase';
export type DocStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'AWAITING_SIGNATURE' | 'SIGNED_OFF';

export interface AdminProvider {
  id: 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'deepseek';
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
}

export interface AdminAgent {
  id: string;
  name: string;
  description: string;
}

export interface AdminSettingsConfig {
  providers: AdminProvider[];
  agentModels: Record<string, string>; // agentId -> "providerId/modelId"
  executionPolicy: 'always-proceed' | 'request-review' | 'strict-approvals';
  fileAccessPolicy: 'workspace-only' | 'external-minio' | 'unrestricted';
  internetAccessPolicy: 'allow' | 'ask' | 'deny';
  activeSkills: string[];
}

export interface SDLCProject {
  id: string;
  name: string;
  key: string;
  description: string;
  targetDate: string;
  status: 'Active' | 'Review' | 'Completed';
  brsStatus: DocStatus;
  srsStatus: DocStatus;
  testCaseStatus: DocStatus;
  assignedPersonas: PersonaRole[];
  currentBrsStep: number;
  currentSrsStep: number;
  currentTestCaseStep: number;
}
