import { useState, useEffect } from 'react';
import type { AdminSettingsConfig } from '../types';
import { getAdminConfig, saveAdminConfig } from '../lib/api';
import {
  ShieldAlert,
  Bot,
  Key,
  Cpu,
  ShieldCheck,
  HardDrive,
  CheckCircle2,
  Lock,
  Wrench,
} from 'lucide-react';

export function AdminSettings() {
  const [adminConfig, setAdminConfig] = useState<AdminSettingsConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'models' | 'policies' | 'mcp' | 'keycloak' | 'minio'>('models');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminConfig()
      .then((cfg) => {
        setAdminConfig(cfg);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    if (!adminConfig) return;
    try {
      await saveAdminConfig(adminConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-muted-foreground text-sm">Loading admin config…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-destructive text-sm">Error: {error}</div>
      </div>
    );
  }

  if (!adminConfig) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between p-6 rounded-xl border border-border bg-card">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
            <ShieldAlert className="size-4" />
            <span>AetherSpec Platform Governance · Admin Scope</span>
          </div>
          <h1 className="text-xl font-bold text-foreground mt-1">Admin Settings & Model Router Console</h1>
          <p className="text-muted-foreground text-xs mt-1">
            Configure LLM Provider API keys, per-agent routing matrix, tool execution policies, and infrastructure settings.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs px-4 py-2 rounded-lg transition-all"
        >
          <CheckCircle2 className="size-4" />
          {saved ? 'Saved!' : 'Save Config'}
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs font-mono">
        <TabButton active={activeTab === 'models'} onClick={() => setActiveTab('models')} icon={<Cpu className="size-4" />} label="AI Models & Providers" />
        <TabButton active={activeTab === 'policies'} onClick={() => setActiveTab('policies')} icon={<Lock className="size-4" />} label="Execution Policies" />
        <TabButton active={activeTab === 'mcp'} onClick={() => setActiveTab('mcp')} icon={<Wrench className="size-4" />} label="Skills & MCP" />
        <TabButton active={activeTab === 'keycloak'} onClick={() => setActiveTab('keycloak')} icon={<ShieldCheck className="size-4" />} label="Keycloak OIDC" />
        <TabButton active={activeTab === 'minio'} onClick={() => setActiveTab('minio')} icon={<HardDrive className="size-4" />} label="MinIO & KVKK" />
      </div>

      {activeTab === 'models' && (
        <div className="space-y-6 text-xs">
          <div className="p-5 rounded-xl border border-border bg-card space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2 text-primary font-bold text-sm">
                <Bot className="size-4" />
                <span>Per-Agent Model Routing Matrix</span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">Dynamically maps agents to LLM backends</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AgentModelCard
                title="brs-agent"
                description="Generates Business Requirement Specs"
                value={adminConfig.agentModels.brsAgentModel}
                options={[
                  { value: 'ollama/llama3.1:70b', label: 'Ollama · Llama 3.1 70B' },
                  { value: 'ollama/llama3.1:8b', label: 'Ollama · Llama 3.1 8B' },
                  { value: 'ollama/qwen2.5:72b', label: 'Ollama · Qwen 2.5 72B' },
                  { value: 'ollama/deepseek-r1:70b', label: 'Ollama · DeepSeek R1 70B' },
                  { value: 'anthropic/claude-3-5-sonnet', label: 'Anthropic · Claude 3.5 Sonnet' },
                  { value: 'openai/gpt-4o', label: 'OpenAI · GPT-4o' },
                ]}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  agentModels: { ...adminConfig.agentModels, brsAgentModel: v },
                })}
              />
              <AgentModelCard
                title="srd-agent"
                description="Generates SRS/SDD & Implementation Backlog"
                value={adminConfig.agentModels.srsAgentModel}
                options={[
                  { value: 'ollama/llama3.1:70b', label: 'Ollama · Llama 3.1 70B' },
                  { value: 'ollama/llama3.1:8b', label: 'Ollama · Llama 3.1 8B' },
                  { value: 'ollama/qwen2.5:72b', label: 'Ollama · Qwen 2.5 72B' },
                  { value: 'ollama/deepseek-r1:70b', label: 'Ollama · DeepSeek R1 70B' },
                  { value: 'anthropic/claude-3-5-sonnet', label: 'Anthropic · Claude 3.5 Sonnet' },
                  { value: 'google/gemini-1.5-pro', label: 'Google · Gemini 1.5 Pro' },
                ]}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  agentModels: { ...adminConfig.agentModels, srsAgentModel: v },
                })}
              />
              <AgentModelCard
                title="testcase-agent"
                description="Generates Test Cases & Traceability"
                value={adminConfig.agentModels.testCaseAgentModel}
                options={[
                  { value: 'ollama/llama3.1:70b', label: 'Ollama · Llama 3.1 70B' },
                  { value: 'ollama/llama3.1:8b', label: 'Ollama · Llama 3.1 8B' },
                  { value: 'ollama/qwen2.5:72b', label: 'Ollama · Qwen 2.5 72B' },
                  { value: 'openai/gpt-4o', label: 'OpenAI · GPT-4o' },
                  { value: 'anthropic/claude-3-5-sonnet', label: 'Anthropic · Claude 3.5 Sonnet' },
                ]}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  agentModels: { ...adminConfig.agentModels, testCaseAgentModel: v },
                })}
              />
            </div>
          </div>

          <div className="p-5 rounded-xl border border-border bg-card space-y-3">
            <div className="flex items-center gap-2 text-foreground font-bold text-sm border-b border-border pb-2">
              <Key className="size-4 text-primary" />
              <span>LLM Provider API Key Management</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ConfigInput
                label="Ollama Cloud Endpoint"
                type="text"
                value={adminConfig.providers.ollamaEndpoint}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  providers: { ...adminConfig.providers, ollamaEndpoint: v },
                })}
              />
              <ConfigInput
                label="Ollama Cloud API Key"
                type="password"
                value={adminConfig.providers.ollamaApiKey}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  providers: { ...adminConfig.providers, ollamaApiKey: v },
                })}
              />
              <ConfigInput
                label="OpenAI API Key"
                type="password"
                value={adminConfig.providers.openaiKey}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  providers: { ...adminConfig.providers, openaiKey: v },
                })}
              />
              <ConfigInput
                label="Anthropic API Key"
                type="password"
                value={adminConfig.providers.anthropicKey}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  providers: { ...adminConfig.providers, anthropicKey: v },
                })}
              />
              <ConfigInput
                label="Google Gemini API Key"
                type="password"
                value={adminConfig.providers.geminiKey}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  providers: { ...adminConfig.providers, geminiKey: v },
                })}
              />
              <ConfigInput
                label="DeepSeek API Key"
                type="password"
                value={adminConfig.providers.deepseekKey}
                onChange={(v) => setAdminConfig({
                  ...adminConfig,
                  providers: { ...adminConfig.providers, deepseekKey: v },
                })}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'policies' && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4 text-xs">
          <div className="flex items-center gap-2 text-primary font-bold text-sm border-b border-border pb-2">
            <Lock className="size-4" />
            <span>Tool Execution & File Access Governance</span>
          </div>

          <div className="space-y-4">
            <PolicySelect
              label="Tool Execution Policy"
              value={adminConfig.executionPolicy}
              options={[
                { value: 'request-review', label: 'request-review (HITL mandatory on validation warnings)' },
                { value: 'strict-approvals', label: 'strict-approvals (Require admin approval for every section)' },
                { value: 'always-proceed', label: 'always-proceed (Automated fast mode)' },
              ]}
              onChange={(v) => setAdminConfig({ ...adminConfig, executionPolicy: v as AdminSettingsConfig['executionPolicy'] })}
            />
            <PolicySelect
              label="File Access Scope Boundary"
              value={adminConfig.fileAccessPolicy}
              options={[
                { value: 'workspace-only', label: 'Workspace Only (Restricted to project templates & specs)' },
                { value: 'external-minio', label: 'External MinIO S3 (Allow bucket reading)' },
                { value: 'unrestricted', label: 'Unrestricted (Not recommended)' },
              ]}
              onChange={(v) => setAdminConfig({ ...adminConfig, fileAccessPolicy: v as AdminSettingsConfig['fileAccessPolicy'] })}
            />
            <PolicySelect
              label="Internet Access Policy"
              value={adminConfig.internetAccessPolicy}
              options={[
                { value: 'allow', label: 'Allow (Agent can access internet)' },
                { value: 'ask', label: 'Ask (Require approval for internet access)' },
                { value: 'deny', label: 'Deny (No internet access)' },
              ]}
              onChange={(v) => setAdminConfig({ ...adminConfig, internetAccessPolicy: v as AdminSettingsConfig['internetAccessPolicy'] })}
            />
          </div>
        </div>
      )}

      {activeTab === 'mcp' && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Wrench className="size-4" />
              <span>Agent Skills</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">{adminConfig.activeSkills.length} active</span>
          </div>

          <div className="space-y-2">
            {adminConfig.activeSkills.map((skill) => (
              <div key={skill} className="p-3 bg-background rounded-lg border border-border flex items-center justify-between font-mono">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-status-approved" />
                  <span className="text-foreground font-semibold">{skill}</span>
                </div>
                <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded">Loaded</span>
              </div>
            ))}
            {adminConfig.activeSkills.length === 0 && (
              <div className="text-muted-foreground text-center py-4">No skills configured</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'keycloak' && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4 text-xs">
          <div className="flex items-center gap-2 text-primary font-bold text-sm border-b border-border pb-2">
            <ShieldCheck className="size-4" />
            <span>Keycloak OIDC Configuration</span>
          </div>
          <div className="space-y-2 font-mono">
            <ReadOnlyRow label="Issuer URL" value={`${import.meta.env.VITE_KEYCLOAK_URL}/realms/${import.meta.env.VITE_KEYCLOAK_REALM}`} />
            <ReadOnlyRow label="Client ID" value={import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string} />
            <ReadOnlyRow label="Realm" value={import.meta.env.VITE_KEYCLOAK_REALM as string} />
          </div>
        </div>
      )}

      {activeTab === 'minio' && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4 text-xs">
          <div className="flex items-center gap-2 text-primary font-bold text-sm border-b border-border pb-2">
            <HardDrive className="size-4" />
            <span>MinIO Object Storage</span>
          </div>
          <div className="space-y-2 font-mono">
            <ReadOnlyRow label="Endpoint" value="127.0.0.1:9000 (server-side)" />
            <ReadOnlyRow label="Bucket" value="aetherspec-artifacts" />
            <ReadOnlyRow label="KVKK PII Redaction" value="Enabled" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper components ──

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-primary/20 border border-primary/40 text-primary font-bold'
          : 'text-muted-foreground hover:bg-accent'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ConfigInput({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-foreground font-mono text-[11px] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border rounded p-2 text-foreground font-mono focus:outline-none focus:border-ring"
      />
    </div>
  );
}

function AgentModelCard({
  title,
  description,
  value,
  options,
  onChange,
}: {
  title: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="p-3 bg-background rounded-lg border border-border space-y-2">
      <div className="font-bold text-primary flex items-center gap-1.5">
        <Bot className="size-3.5" /> {title}
      </div>
      <div className="text-[10px] text-muted-foreground">{description}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-card border border-border rounded p-1.5 text-foreground font-mono"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function PolicySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-foreground font-medium mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border rounded-lg p-2.5 text-foreground font-mono outline-none focus:border-ring"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between p-2 bg-background rounded border border-border">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
