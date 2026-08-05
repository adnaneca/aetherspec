/**
 * Shared types between the web client and the agent sidecar.
 * These are NOT used by the Go gateway (Go has its own types generated
 * from protobuf contracts in packages/proto).
 */

// ----- Health -----
export interface HealthResponse {
  status: 'alive' | 'ready' | 'down';
  service: string;
  checks?: Record<string, string>;
}

// ----- Agent -----
export interface AgentRunRequest {
  agentId: string;
  prompt: string;
  workspaceId: string;
  /** Optional conversation/thread id. */
  threadId?: string;
}

export interface AgentTokenEvent {
  type: 'token';
  delta: string;
  threadId: string;
}

export interface AgentToolCallEvent {
  type: 'tool_call';
  toolName: string;
  args: unknown;
  callId: string;
}

export interface AgentToolResultEvent {
  type: 'tool_result';
  callId: string;
  result: unknown;
  approved: boolean;
}

export interface AgentDoneEvent {
  type: 'done';
  threadId: string;
  tokensUsed: number;
}

export type AgentStreamEvent =
  | AgentTokenEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentDoneEvent;

// ----- Workspace / Files -----
export interface FileNode {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
}
