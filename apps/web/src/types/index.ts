export type ThemeName = "default" | "tomorrow-night-blue" | "bank" | "rental";

export type PersonaRole =
  | "ba_lead"
  | "business_analyst"
  | "solution_architect"
  | "tech_lead"
  | "qa_lead"
  | "scrum_master"
  | "marketing_manager"
  | "admin";

export interface Persona {
  id: PersonaRole;
  name: string;
  title: string;
  avatarUrl: string;
  keycloakRoles: string[];
  department: string;
}

export type DocType = "brs" | "srs" | "srs-fe" | "testcase" | "tc-fe";
export type DocStatus =
  "NOT_STARTED" | "IN_PROGRESS" | "AWAITING_SIGNATURE" | "SIGNED_OFF";

export interface AdminProvider {
  id: "ollama" | "openai" | "anthropic" | "gemini" | "deepseek";
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
}

export interface AdminAgentConfig {
  model: string;
  apiKey: string;
  baseURL: string;
}

export interface AdminAgent {
  id: string;
  name: string;
  description: string;
}

export interface AdminSettingsConfig {
  providers: AdminProvider[];
  agentModels: Record<string, string>; // agentId -> "providerId/modelId"
  agents?: Record<string, AdminAgentConfig>; // per-agent LLM config (WP-02)
  executionPolicy: "always-proceed" | "request-review" | "strict-approvals";
  fileAccessPolicy: "workspace-only" | "external-minio" | "unrestricted";
  internetAccessPolicy: "allow" | "ask" | "deny";
  activeSkills: string[];
}

export type ProjectStatus = "Active" | "Review" | "Completed";

export interface PipelinePhase {
  status: string;
  currentStep: number;
  totalSteps: number;
}

export interface SDLCProject {
  id: string;
  name: string;
  key: string;
  description: string;
  targetDate: string | null;
  status: ProjectStatus;
  pipeline: {
    brs: PipelinePhase;
    srs: PipelinePhase;
    "srs-fe": PipelinePhase;
    testcase: PipelinePhase;
    "tc-fe": PipelinePhase;
  };
  href?: string;
  revision?: number;
  createdBy?: string;
  updatedBy?: string;
  createdDate?: string;
  updatedDate?: string;
  document?: Document[];
}

export interface Document {
  id: string;
  projectId: string;
  docType: DocType;
  status: string;
  currentStep: number;
  totalSteps: number;
  href?: string;
  revision?: number;
  createdBy?: string;
  updatedBy?: string;
  createdDate?: string;
  updatedDate?: string;
}

export interface DocumentStep {
  id?: string;
  documentId?: string;
  stepNumber: number;
  stepName: string;
  description?: string;
  status: string;
  version: number;
  revisionCount: number;
  revision?: number;
  approvedBy: string | null;
  approvedAt: string | null;
  minioPath: string | null;
  content?: string;
}

export interface UserSettingsConfig {
  theme: "dark" | "light" | "system";
  language: "en" | "tr";
  canvasWidth: "default" | "wide" | "full";
  density: "compact" | "comfortable";
  artifactReviewMode: "agent-decides" | "always-ask" | "auto-proceed";
  visualDiffs: boolean;
  strictGherkin: boolean;
  emailNotifications: boolean;
  soundAlerts: boolean;
}
