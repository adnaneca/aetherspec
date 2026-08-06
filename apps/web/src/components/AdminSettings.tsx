import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { AdminSettingsConfig, AdminProvider } from '../types';
import {
  getAdminConfig,
  saveAdminConfig,
  getOllamaModels,
  testProvider,
  type TestProviderResult,
} from '../lib/api';
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
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';

const FALLBACK_OLLAMA_MODELS = [
  'llama3.1:70b',
  'llama3.1:8b',
  'qwen2.5:72b',
  'deepseek-r1:70b',
];

const CLOUD_PROVIDER_CATALOG: Record<Exclude<AdminProvider['id'], 'ollama'>, { name: string; models: string[] }> = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'],
  },
  anthropic: {
    name: 'Anthropic',
    models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-5-haiku'],
  },
  gemini: {
    name: 'Google Gemini',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
  },
  deepseek: {
    name: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
};

const AGENTS = [
  {
    id: 'brs-agent',
    name: 'brs-agent',
    description: 'Generates Business Requirement Specs',
    icon: Bot,
  },
  {
    id: 'srd-agent',
    name: 'srd-agent',
    description: 'Generates SRS/SDD & Implementation Backlog',
    icon: Bot,
  },
  {
    id: 'testcase-agent',
    name: 'testcase-agent',
    description: 'Generates Test Cases & Traceability',
    icon: Bot,
  },
];

const DEFAULT_PROVIDERS: AdminProvider[] = [
  { id: 'ollama', name: 'Ollama Cloud', enabled: true, apiKey: '', baseUrl: 'https://ollama.cloud/v1' },
  { id: 'openai', name: 'OpenAI', enabled: false, apiKey: '' },
  { id: 'anthropic', name: 'Anthropic', enabled: false, apiKey: '' },
  { id: 'gemini', name: 'Google Gemini', enabled: false, apiKey: '' },
  { id: 'deepseek', name: 'DeepSeek', enabled: false, apiKey: '' },
];

const DEFAULT_CONFIG: AdminSettingsConfig = {
  providers: DEFAULT_PROVIDERS,
  agentModels: {
    'brs-agent': 'ollama/llama3.1:70b',
    'srd-agent': 'ollama/llama3.1:70b',
    'testcase-agent': 'ollama/llama3.1:70b',
  },
  executionPolicy: 'request-review',
  fileAccessPolicy: 'workspace-only',
  internetAccessPolicy: 'allow',
  activeSkills: [
    'generate-brs-section',
    'validate-brs-section',
    'generate-srs-section',
    'validate-srs-section',
    'generate-testcase-section',
  ],
};

/**
 * Normalize legacy config shapes (old object-based providers) to the new provider array shape.
 */
function normalizeConfig(raw: unknown): AdminSettingsConfig {
  const cfg = raw as Partial<AdminSettingsConfig> | Record<string, unknown>;
  const next: AdminSettingsConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  if (cfg && typeof cfg === 'object') {
    // Providers
    const rawProviders = cfg.providers;
    if (Array.isArray(rawProviders)) {
      // new shape
      const byId = new Map(rawProviders.map((p) => [p.id, p]));
      next.providers = DEFAULT_PROVIDERS.map((def) => ({
        ...def,
        ...(byId.get(def.id) || {}),
        id: def.id,
        name: def.name,
      }));
    } else if (rawProviders && typeof rawProviders === 'object') {
      // legacy shape: { ollamaEndpoint, ollamaApiKey, openaiKey, ... }
      const legacy = rawProviders as Record<string, string>;
      next.providers = DEFAULT_PROVIDERS.map((def) => {
        const keyMap: Record<string, string | undefined> = {
          ollama: legacy.ollamaApiKey,
          openai: legacy.openaiKey,
          anthropic: legacy.anthropicKey,
          gemini: legacy.geminiKey,
          deepseek: legacy.deepseekKey,
        };
        return {
          ...def,
          enabled: !!keyMap[def.id] || def.id === 'ollama',
          apiKey: keyMap[def.id] || '',
          baseUrl: def.id === 'ollama' ? legacy.ollamaEndpoint || def.baseUrl : def.baseUrl,
        };
      });
    }

    // Agent models
    const rawAgentModels = cfg.agentModels;
    if (rawAgentModels && typeof rawAgentModels === 'object') {
      Object.entries(rawAgentModels as Record<string, string>).forEach(([k, v]) => {
        if (next.agentModels[k] !== undefined) {
          next.agentModels[k] = v;
        }
      });
    }

    // Policies
    if (cfg.executionPolicy) next.executionPolicy = cfg.executionPolicy as AdminSettingsConfig['executionPolicy'];
    if (cfg.fileAccessPolicy) next.fileAccessPolicy = cfg.fileAccessPolicy as AdminSettingsConfig['fileAccessPolicy'];
    if (cfg.internetAccessPolicy) next.internetAccessPolicy = cfg.internetAccessPolicy as AdminSettingsConfig['internetAccessPolicy'];

    // Skills
    if (Array.isArray(cfg.activeSkills)) next.activeSkills = cfg.activeSkills as string[];
  }

  return next;
}

export function AdminSettings() {
  const navigate = useNavigate();
  const [adminConfig, setAdminConfig] = useState<AdminSettingsConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'providers' | 'models' | 'policies' | 'mcp' | 'keycloak' | 'minio'>(
    'providers'
  );
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>(FALLBACK_OLLAMA_MODELS);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);

  useEffect(() => {
    getAdminConfig()
      .then((cfg) => {
        setAdminConfig(normalizeConfig(cfg));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, TestProviderResult | null>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  const fetchOllamaModels = async () => {
    setOllamaModelsLoading(true);
    try {
      const data = await getOllamaModels();
      const names = data.models?.map((m) => m.name).filter(Boolean) ?? [];
      if (names.length > 0) {
        setOllamaModels(names);
      }
    } catch (err) {
      console.warn('[AdminSettings] failed to fetch Ollama models via gateway:', err);
    } finally {
      setOllamaModelsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'providers' || activeTab === 'models') {
      void fetchOllamaModels();
    }
  }, [activeTab]);

  const handleTestProvider = async (provider: AdminProvider) => {
    setTestingProvider(provider.id);
    setProviderTestStatus((prev) => ({ ...prev, [provider.id]: null }));
    try {
      const result = await testProvider(provider);
      setProviderTestStatus((prev) => ({ ...prev, [provider.id]: result }));
    } catch (err) {
      setProviderTestStatus((prev) => ({
        ...prev,
        [provider.id]: { status: 'failed', reason: (err as Error).message },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

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

  const updateProvider = (id: AdminProvider['id'], patch: Partial<AdminProvider>) => {
    if (!adminConfig) return;
    setAdminConfig({
      ...adminConfig,
      providers: adminConfig.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  const enabledProviders = adminConfig?.providers.filter((p) => p.enabled) ?? [];

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
      {/* Header */}
      <div className="flex items-center justify-between p-6 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate({ to: '/' })}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs font-mono"
            title="Return to ProjectHub"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
          <div className="h-6 w-px bg-border" />
          <div>
            <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
              <ShieldAlert className="size-4" />
              <span>AetherSpec Platform Governance · Admin Scope</span>
            </div>
            <h1 className="text-xl font-bold text-foreground mt-1">Admin Settings & Model Router Console</h1>
            <p className="text-muted-foreground text-xs mt-1">
              Enable LLM providers, set their API keys, then route each agent to a model from the selected providers.
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs px-4 py-2 rounded-lg transition-all"
        >
          <CheckCircle2 className="size-4" />
          {saved ? 'Saved!' : 'Save Config'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs font-mono">
        <TabButton active={activeTab === 'providers'} onClick={() => setActiveTab('providers')} icon={<Key className="size-4" />} label="Provider Setup" />
        <TabButton active={activeTab === 'models'} onClick={() => setActiveTab('models')} icon={<Cpu className="size-4" />} label="Model Routing" />
        <TabButton active={activeTab === 'policies'} onClick={() => setActiveTab('policies')} icon={<Lock className="size-4" />} label="Execution Policies" />
        <TabButton active={activeTab === 'mcp'} onClick={() => setActiveTab('mcp')} icon={<Wrench className="size-4" />} label="Skills & MCP" />
        <TabButton active={activeTab === 'keycloak'} onClick={() => setActiveTab('keycloak')} icon={<ShieldCheck className="size-4" />} label="Keycloak OIDC" />
        <TabButton active={activeTab === 'minio'} onClick={() => setActiveTab('minio')} icon={<HardDrive className="size-4" />} label="MinIO & KVKK" />
      </div>

      {/* Providers Tab */}
      {activeTab === 'providers' && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4 text-xs">
          <div className="flex items-center gap-2 text-primary font-bold text-sm border-b border-border pb-2">
            <Key className="size-4" />
            <span>LLM Provider Setup</span>
          </div>
          <p className="text-muted-foreground">
            Tick the providers you want to use, enter their API keys, then switch to the Model Routing tab to assign models per agent.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {adminConfig.providers.map((provider) => (
              <div
                key={provider.id}
                className={`p-4 rounded-lg border space-y-3 transition-colors ${
                  provider.enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'
                }`}
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(e) => updateProvider(provider.id, { enabled: e.target.checked })}
                    className="size-4 accent-primary rounded"
                  />
                  <span className="font-semibold text-foreground">{provider.name}</span>
                  {provider.id === 'ollama' && ollamaModelsLoading && (
                    <span className="text-[10px] text-muted-foreground ml-auto">fetching models…</span>
                  )}
                </label>

                {provider.id === 'ollama' && (
                  <ConfigInput
                    label="Endpoint URL"
                    type="text"
                    value={provider.baseUrl || ''}
                    onChange={(v) => updateProvider(provider.id, { baseUrl: v })}
                  />
                )}

                <ConfigInput
                  label="API Key"
                  type="password"
                  value={provider.apiKey}
                  onChange={(v) => updateProvider(provider.id, { apiKey: v })}
                />

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => handleTestProvider(provider)}
                    disabled={testingProvider === provider.id || !provider.apiKey}
                    className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1.5 rounded border border-border bg-background hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`size-3 ${testingProvider === provider.id ? 'animate-spin' : ''}`} />
                    {testingProvider === provider.id ? 'Testing…' : 'Test'}
                  </button>
                  <ProviderStatus status={providerTestStatus[provider.id]} />
                </div>

                {provider.id === 'ollama' && (
                  <p className="text-[10px] text-muted-foreground">
                    Model list pulled from ollama.com/api/tags ({ollamaModels.length} models available).
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models Tab */}
      {activeTab === 'models' && (
        <div className="space-y-6 text-xs">
          <div className="p-5 rounded-xl border border-border bg-card space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2 text-primary font-bold text-sm">
                <Cpu className="size-4" />
                <span>Per-Agent Model Routing Matrix</span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">Only models from enabled providers are shown</span>
            </div>

            {enabledProviders.length === 0 && (
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
                No providers enabled. Go to the Provider Setup tab and tick at least one provider.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {AGENTS.map((agent) => (
                <div key={agent.id} className="p-3 bg-background rounded-lg border border-border space-y-2">
                  <div className="font-bold text-primary flex items-center gap-1.5">
                    <agent.icon className="size-3.5" /> {agent.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{agent.description}</div>
                  <select
                    value={adminConfig.agentModels[agent.id] || ''}
                    onChange={(e) =>
                      setAdminConfig({
                        ...adminConfig,
                        agentModels: { ...adminConfig.agentModels, [agent.id]: e.target.value },
                      })
                    }
                    disabled={enabledProviders.length === 0}
                    className="w-full bg-card border border-border rounded p-1.5 text-foreground font-mono disabled:opacity-50"
                  >
                    {enabledProviders.length === 0 && <option value="">— no provider enabled —</option>}
                    {enabledProviders.map((provider) => {
                      const models =
                        provider.id === 'ollama'
                          ? ollamaModels
                          : CLOUD_PROVIDER_CATALOG[provider.id].models;
                      return (
                        <optgroup key={provider.id} label={provider.name}>
                          {models.map((model) => (
                            <option key={`${provider.id}/${model}`} value={`${provider.id}/${model}`}>
                              {model}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Policies Tab */}
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

      {/* Skills Tab */}
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

      {/* Keycloak Tab */}
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

      {/* MinIO Tab */}
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

function ProviderStatus({ status }: { status: TestProviderResult | null | undefined }) {
  if (!status) return null;
  if (status.status === 'connected') {
    return (
      <span className="text-[10px] font-mono text-status-approved flex items-center gap-1">
        <CheckCircle2 className="size-3" /> Connected
      </span>
    );
  }
  return (
    <span className="text-[10px] font-mono text-destructive" title={status.reason || ''}>
      Failed{status.reason ? `: ${status.reason}` : ''}
    </span>
  );
}

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
