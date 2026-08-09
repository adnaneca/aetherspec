import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useI18n } from '../lib/i18n-context';
import { useTheme } from '../lib/theme';
import type { Persona, UserSettingsConfig } from '../types';
import { getUserSettings, saveUserSettings } from '../lib/api';
import {
  Sliders,
  Sun,
  Moon,
  Globe,
  Layout,
  Bell,
  Eye,
  CheckCircle2,
  ShieldCheck,
  Monitor,
} from 'lucide-react';

type AetherTheme = 'tomorrow-night-blue' | 'bank' | 'rental' | 'default';

interface UserSettingsProps {
  activePersona: Persona;
}

export function UserSettings({ activePersona }: UserSettingsProps) {
  const { t } = useTranslation();
  const { setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<UserSettingsConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appliedTheme, setAppliedTheme] = useState<AetherTheme>(theme);

  useEffect(() => {
    getUserSettings()
      .then((cfg) => {
        setSettings(cfg);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const updateSettings = (patch: Partial<UserSettingsConfig>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleLanguageChange = (lang: 'en' | 'tr') => {
    updateSettings({ language: lang });
    setLanguage(lang);
  };

  const applyTheme = (themeName: AetherTheme) => {
    setAppliedTheme(themeName);
    setTheme(themeName);
  };

  useEffect(() => {
    setAppliedTheme(theme);
  }, [theme]);

  const handleSave = async () => {
    if (!settings) return;
    try {
      await saveUserSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-muted-foreground text-sm">{t('common.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-destructive text-sm">
          {t('common.error')}: {error}
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between p-6 rounded-xl border border-border bg-card">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
            <Sliders className="size-4" />
            <span>{t('userSettings.header')}</span>
          </div>
          <h1 className="text-xl font-bold text-foreground mt-1">{t('userSettings.title')}</h1>
          <p className="text-muted-foreground text-xs mt-1">{t('userSettings.subtitle')}</p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs px-4 py-2 rounded-lg transition-all"
        >
          <CheckCircle2 className="size-4" />
          {saved ? t('userSettings.saved') : t('userSettings.save')}
        </button>
      </div>

      {/* User Profile Card */}
      <div className="p-5 rounded-xl border border-border bg-card flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={activePersona.avatarUrl}
            alt={activePersona.name}
            className="size-12 rounded-full object-cover ring-2 ring-primary/20"
          />
          <div>
            <h3 className="font-bold text-foreground text-sm">{activePersona.name}</h3>
            <p className="text-xs text-muted-foreground">
              {activePersona.title} · {activePersona.department}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <ShieldCheck className="size-3 text-status-approved" />
              <span className="font-mono text-[10px] text-muted-foreground">
                {t('userSettings.keycloakScope')}: {activePersona.keycloakRoles.join(' · ')}
              </span>
            </div>
          </div>
        </div>

        <span className="font-mono text-xs bg-muted/30 text-foreground border border-border px-3 py-1 rounded-lg">
          {t('userSettings.activePersona')}: {activePersona.id}
        </span>
      </div>

      {/* Preferences Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        {/* Appearance & Layout Card */}
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <div className="flex items-center gap-2 text-foreground font-bold text-sm border-b border-border pb-2">
            <Layout className="size-4 text-primary" />
            <span>{t('userSettings.appearance')}</span>
          </div>

          <div className="space-y-3">
            {/* Theme Mode */}
            <div>
              <label className="block text-foreground font-medium mb-1">{t('userSettings.themeMode')}</label>
              <div className="grid grid-cols-3 gap-2">
                <ThemeButton
                  active={settings.theme === 'dark'}
                  onClick={() => updateSettings({ theme: 'dark' })}
                  icon={<Moon className="size-3.5" />}
                  label={t('userSettings.darkMode')}
                />
                <ThemeButton
                  active={settings.theme === 'light'}
                  onClick={() => updateSettings({ theme: 'light' })}
                  icon={<Sun className="size-3.5" />}
                  label={t('userSettings.lightMode')}
                />
                <ThemeButton
                  active={settings.theme === 'system'}
                  onClick={() => updateSettings({ theme: 'system' })}
                  icon={<Monitor className="size-3.5" />}
                  label={t('userSettings.system')}
                />
              </div>

              {/* AetherSpec Theme Selector */}
              <label className="block text-foreground font-medium mb-1 mt-3">AetherSpec Theme</label>
              <div className="grid grid-cols-2 gap-2">
                <ThemeButton
                  active={appliedTheme === 'tomorrow-night-blue'}
                  onClick={() => applyTheme('tomorrow-night-blue')}
                  label="Tomorrow Night Blue"
                />
                <ThemeButton
                  active={appliedTheme === 'bank'}
                  onClick={() => applyTheme('bank')}
                  label="Bank Enterprise"
                />
                <ThemeButton
                  active={appliedTheme === 'rental'}
                  onClick={() => applyTheme('rental')}
                  label="Rental Modern"
                />
                <ThemeButton
                  active={appliedTheme === 'default'}
                  onClick={() => applyTheme('default')}
                  label="Plain Dark"
                />
              </div>
            </div>

            {/* Language */}
            <div>
              <label className="block text-foreground font-medium mb-1">{t('userSettings.language')}</label>
              <div className="grid grid-cols-2 gap-2">
                <ThemeButton
                  active={settings.language === 'en'}
                  onClick={() => handleLanguageChange('en')}
                  icon={<Globe className="size-3.5" />}
                  label="English"
                />
                <ThemeButton
                  active={settings.language === 'tr'}
                  onClick={() => handleLanguageChange('tr')}
                  icon={<Globe className="size-3.5" />}
                  label="Türkçe"
                />
              </div>
            </div>

            {/* Density */}
            <div>
              <label className="block text-foreground font-medium mb-1">{t('userSettings.density')}</label>
              <div className="grid grid-cols-2 gap-2">
                <ThemeButton
                  active={settings.density === 'comfortable'}
                  onClick={() => updateSettings({ density: 'comfortable' })}
                  label={t('userSettings.comfortable')}
                />
                <ThemeButton
                  active={settings.density === 'compact'}
                  onClick={() => updateSettings({ density: 'compact' })}
                  label={t('userSettings.compact')}
                />
              </div>
            </div>

            {/* Canvas Width */}
            <div>
              <label className="block text-foreground font-medium mb-1">{t('userSettings.canvasWidth')}</label>
              <div className="grid grid-cols-3 gap-2">
                <ThemeButton
                  active={settings.canvasWidth === 'default'}
                  onClick={() => updateSettings({ canvasWidth: 'default' })}
                  label={t('userSettings.canvasDefault')}
                />
                <ThemeButton
                  active={settings.canvasWidth === 'wide'}
                  onClick={() => updateSettings({ canvasWidth: 'wide' })}
                  label={t('userSettings.canvasWide')}
                />
                <ThemeButton
                  active={settings.canvasWidth === 'full'}
                  onClick={() => updateSettings({ canvasWidth: 'full' })}
                  label={t('userSettings.canvasFull')}
                />
              </div>
            </div>
          </div>
        </div>

        {/* AI Interaction & HITL Review Card */}
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <div className="flex items-center gap-2 text-foreground font-bold text-sm border-b border-border pb-2">
            <Eye className="size-4 text-primary" />
            <span>{t('userSettings.aiInteraction')}</span>
          </div>

          <div className="space-y-3">
            {/* Review Policy */}
            <div>
              <label className="block text-foreground font-medium mb-1">{t('userSettings.reviewPolicy')}</label>
              <select
                value={settings.artifactReviewMode}
                onChange={(e) => updateSettings({ artifactReviewMode: e.target.value as any })}
                className="w-full bg-background border border-border rounded-lg p-2.5 text-foreground font-mono outline-none focus:border-ring"
              >
                <option value="always-ask">{t('userSettings.alwaysAsk')}</option>
                <option value="agent-decides">{t('userSettings.agentDecides')}</option>
                <option value="auto-proceed">{t('userSettings.autoProceed')}</option>
              </select>
            </div>

            {/* Toggles */}
            <div className="pt-2 space-y-2">
              <ToggleRow
                title={t('userSettings.visualDiffs')}
                desc={t('userSettings.visualDiffsDesc')}
                checked={settings.visualDiffs}
                onChange={(v) => updateSettings({ visualDiffs: v })}
              />
              <ToggleRow
                title={t('userSettings.strictGherkin')}
                desc={t('userSettings.strictGherkinDesc')}
                checked={settings.strictGherkin}
                onChange={(v) => updateSettings({ strictGherkin: v })}
              />
            </div>
          </div>

          {/* Notifications */}
          <div className="flex items-center gap-2 text-foreground font-bold text-sm border-b border-border pb-2">
            <Bell className="size-4 text-primary" />
            <span>{t('userSettings.notifications')}</span>
          </div>

          <div className="space-y-2">
            <ToggleRow
              title={t('userSettings.emailNotifications')}
              desc={t('userSettings.emailNotificationsDesc')}
              checked={settings.emailNotifications}
              onChange={(v) => updateSettings({ emailNotifications: v })}
            />
            <ToggleRow
              title={t('userSettings.soundAlerts')}
              desc={t('userSettings.soundAlertsDesc')}
              checked={settings.soundAlerts}
              onChange={(v) => updateSettings({ soundAlerts: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 font-semibold transition-colors ${
        active
          ? 'bg-primary/20 border-primary/40 text-primary font-bold'
          : 'bg-background border-border text-muted-foreground hover:bg-accent'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between p-2 rounded-lg bg-background border border-border cursor-pointer">
      <div>
        <div className="font-semibold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground">{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
    </label>
  );
}
