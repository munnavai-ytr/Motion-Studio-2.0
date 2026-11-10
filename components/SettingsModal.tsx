'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  KeyRound,
  Shield,
  Sliders,
  Trash2,
  Plus,
  RefreshCw,
  Download,
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Clock,
  Sparkles,
  Sun,
  Moon,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Edit2,
  WifiOff,
  Info,
  Cpu,
  Package,
} from 'lucide-react';
import { db } from '../lib/db';
import { setPassphrase, removePassphrase, isPassphraseProtected, clearDeviceVault } from '../lib/crypto';
import {
  addNewKey,
  checkKeyHealth,
  checkAllKeysHealth,
  renameKey,
  AUTO_MODEL_ID,
  getAvailableChatModels,
} from '../lib/gemini';
import { appEvents } from '../lib/events';
import { useCurrentTime } from '../lib/clock';
import { DeviceCheckTab } from './DeviceCheckTab';
import { ModulesTab } from './ModulesTab';
import type { StoredKey } from '../lib/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  keys: StoredKey[];
  onKeysChanged: () => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

type TabType = 'keys' | 'models' | 'appearance' | 'security' | 'data' | 'device-check' | 'modules';

export function SettingsModal({
  isOpen,
  onClose,
  keys,
  onKeysChanged,
  theme,
  onThemeChange,
  selectedModel,
  onModelChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('keys');
  const [mobileSubSection, setMobileSubSection] = useState<TabType | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Add Key inline state
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);
  const [addKeyLoading, setAddKeyLoading] = useState(false);
  const [addKeyError, setAddKeyError] = useState<string | null>(null);

  // Key action states
  const [checkingKeyId, setCheckingKeyId] = useState<string | null>(null);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editingKeyLabel, setEditingKeyLabel] = useState('');
  const [showDetailsKeyId, setShowDetailsKeyId] = useState<string | null>(null);

  // Confirmation Overlays
  const [confirmDeleteKeyId, setConfirmDeleteKeyId] = useState<string | null>(null);
  const [confirmRemoveAllKeys, setConfirmRemoveAllKeys] = useState(false);
  const [confirmDeleteAllData, setConfirmDeleteAllData] = useState(false);

  // Security / Passphrase State
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [currentPassphraseInput, setCurrentPassphraseInput] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseSuccess, setPassphraseSuccess] = useState<string | null>(null);
  const [passphraseLoading, setPassphraseLoading] = useState(false);

  // Live timer tick for relative time & cooldown updates
  const now = useCurrentTime();

  // Check mobile viewport
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Periodic health check: every 60s while Settings is open
  useEffect(() => {
    if (!isOpen) return;
    isPassphraseProtected().then(setHasPassphrase);

    const interval = setInterval(() => {
      checkAllKeysHealth().catch(() => {});
    }, 60000);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mobileSubSection) {
          setMobileSubSection(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mobileSubSection, onClose]);

  // Compute key summary line: "3 keys · 2 healthy · 1 limited"
  const summaryText = useMemo(() => {
    if (keys.length === 0) return '0 keys configured';
    const total = keys.length;
    const healthy = keys.filter((k) => k.healthStatus === 'healthy' || k.state === 'active').length;
    const limited = keys.filter((k) => k.healthStatus === 'limited' || k.state === 'rate-limited').length;
    const invalid = keys.filter((k) => k.healthStatus === 'invalid' || k.state === 'invalid').length;
    const checking = keys.filter((k) => k.healthStatus === 'checking').length;

    const parts = [`${total} key${total > 1 ? 's' : ''}`];
    if (healthy > 0) parts.push(`${healthy} healthy`);
    if (limited > 0) parts.push(`${limited} limited`);
    if (invalid > 0) parts.push(`${invalid} invalid`);
    if (checking > 0) parts.push(`${checking} checking`);

    return parts.join(' · ');
  }, [keys]);

  // Available chat models across keys
  const availableChatModels = useMemo(() => getAvailableChatModels(keys), [keys]);

  if (!isOpen) return null;

  // Add Key Handler: Saves immediately, runs background check
  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newApiKey.trim();
    if (!clean) {
      setAddKeyError('Please enter a valid Gemini API key.');
      return;
    }

    setAddKeyLoading(true);
    setAddKeyError(null);

    try {
      await addNewKey(clean, newKeyLabel.trim() || undefined);
      setNewApiKey('');
      setNewKeyLabel('');
      setIsAddingKey(false);
      onKeysChanged();
    } catch (err: any) {
      setAddKeyError(err?.message || 'Failed to encrypt and store key.');
    } finally {
      setAddKeyLoading(false);
    }
  };

  // Check single key now
  const handleCheckKey = async (keyId: string) => {
    setCheckingKeyId(keyId);
    try {
      await checkKeyHealth(keyId);
      onKeysChanged();
    } finally {
      setCheckingKeyId(null);
    }
  };

  // Check all keys now
  const handleCheckAll = async () => {
    setIsCheckingAll(true);
    try {
      await checkAllKeysHealth();
      onKeysChanged();
    } finally {
      setIsCheckingAll(false);
    }
  };

  // Rename key
  const handleSaveRename = async (keyId: string) => {
    if (editingKeyLabel.trim()) {
      await renameKey(keyId, editingKeyLabel.trim());
      setEditingKeyId(null);
      setEditingKeyLabel('');
      onKeysChanged();
    }
  };

  // Delete key
  const handleDeleteKey = async (id: string) => {
    await db.keys.delete(id);
    setConfirmDeleteKeyId(null);
    onKeysChanged();
    appEvents.emit('keys:changed');
  };

  // Remove all keys
  const handleRemoveAllKeys = async () => {
    await db.keys.clear();
    setConfirmRemoveAllKeys(false);
    onKeysChanged();
    appEvents.emit('keys:changed');
  };

  // Format relative timestamp
  const formatTimeAgo = (ts?: number) => {
    if (!ts) return 'Never';
    const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  // Passphrase actions
  const handleSavePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphraseInput.trim()) {
      setPassphraseError('Passphrase cannot be empty.');
      return;
    }

    setPassphraseLoading(true);
    setPassphraseError(null);
    setPassphraseSuccess(null);

    const res = await setPassphrase(
      passphraseInput.trim(),
      hasPassphrase ? currentPassphraseInput.trim() : undefined
    );
    setPassphraseLoading(false);

    if (res.success) {
      setHasPassphrase(true);
      setPassphraseInput('');
      setCurrentPassphraseInput('');
      setPassphraseSuccess('Passphrase saved! Keys re-encrypted.');
      onKeysChanged();
    } else {
      setPassphraseError(res.error || 'Failed to update passphrase.');
    }
  };

  const handleRemovePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassphraseInput.trim()) {
      setPassphraseError('Enter current passphrase to remove protection.');
      return;
    }

    setPassphraseLoading(true);
    setPassphraseError(null);
    setPassphraseSuccess(null);

    const res = await removePassphrase(currentPassphraseInput.trim());
    setPassphraseLoading(false);

    if (res.success) {
      setHasPassphrase(false);
      setCurrentPassphraseInput('');
      setPassphraseSuccess('Passphrase removed. Default device key restored.');
      onKeysChanged();
    } else {
      setPassphraseError(res.error || 'Incorrect passphrase.');
    }
  };

  // Export JSON
  const handleExportData = async () => {
    const conversations = await db.conversations.toArray();
    const messages = await db.messages.toArray();
    const settings = await db.settings.toArray();
    const safeSettings = settings.filter(
      (s) => !s.key.includes('passphrase') && !s.key.includes('crypto')
    );

    const exportBundle = {
      app: 'Motion Studio',
      exportedAt: new Date().toISOString(),
      conversations,
      messages,
      settings: safeSettings,
      note: 'API keys are strictly never included in data exports for security.',
    };

    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `motion-studio-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Wipe All Data
  const handleDeleteAllData = async () => {
    await db.conversations.clear();
    await db.messages.clear();
    await db.keys.clear();
    await db.settings.clear();
    await clearDeviceVault();
    setConfirmDeleteAllData(false);
    onClose();
    window.location.reload();
  };

  // SECTION CONTENT RENDERING
  const renderKeysContent = () => (
    <div className="space-y-4">
      {/* BYOK Explanation */}
      <div className="p-3 bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded-lg text-xs leading-relaxed text-[var(--text-muted)]">
        <p className="font-semibold text-[var(--text-main)] mb-0.5">Bring Your Own Key (BYOK)</p>
        <p>
          Connect your personal Gemini API key directly. You pay Google standard developer rates with zero markup.
        </p>
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[var(--color-vermilion)] font-medium mt-1 hover:underline"
        >
          <span>Get a Gemini API key from Google AI Studio</span>
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Summary bar + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-[var(--border-color)]">
        <div>
          <span className="text-xs font-semibold text-[var(--text-main)]">{summaryText}</span>
        </div>
        <div className="flex items-center gap-2">
          {keys.length > 0 && (
            <button
              type="button"
              onClick={handleCheckAll}
              disabled={isCheckingAll}
              className="btn-secondary text-xs py-1 px-2.5"
              title="Test all keys against Google Gemini API"
            >
              {isCheckingAll ? (
                <Loader2 size={12} className="spinner" />
              ) : (
                <RefreshCw size={12} />
              )}
              <span>Check all</span>
            </button>
          )}

          {!isAddingKey && (
            <button
              type="button"
              onClick={() => setIsAddingKey(true)}
              className="btn-primary text-xs py-1 px-2.5"
            >
              <Plus size={13} />
              <span>Add key</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Add Key Form */}
      {isAddingKey && (
        <form onSubmit={handleAddKey} className="p-3 bg-[var(--bg-surface-hover)] border border-[var(--border-focus)] rounded-lg space-y-3">
          <h4 className="text-xs font-semibold text-[var(--text-main)]">Add New Gemini Key</h4>
          <div>
            <label htmlFor="modal-new-key" className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
              API Key <span className="text-[var(--color-vermilion)]">*</span>
            </label>
            <div className="relative flex items-center">
              <input
                id="modal-new-key"
                type={showNewKey ? 'text' : 'password'}
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="AIzaSy..."
                autoFocus
                required
                className="w-full text-xs py-1.5 pl-2.5 pr-8 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded text-[var(--text-main)] focus:outline-none focus:border-[var(--color-vermilion)]"
              />
              <button
                type="button"
                onClick={() => setShowNewKey(!showNewKey)}
                className="absolute right-2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                aria-label={showNewKey ? 'Hide key' : 'Show key'}
              >
                {showNewKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="modal-new-label" className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
              Name or Label <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <input
              id="modal-new-label"
              type="text"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              placeholder="e.g. Personal, Work, Pro"
              className="w-full text-xs py-1.5 px-2.5 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded text-[var(--text-main)] focus:outline-none focus:border-[var(--color-vermilion)]"
            />
          </div>

          {addKeyError && (
            <div className="text-xs text-[var(--color-error)] bg-[var(--color-error-subtle)] p-2 rounded flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0" />
              <span>{addKeyError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsAddingKey(false);
                setAddKeyError(null);
                setNewApiKey('');
                setNewKeyLabel('');
              }}
              className="btn-secondary text-xs py-1 px-2.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addKeyLoading || !newApiKey.trim()}
              className="btn-primary text-xs py-1 px-3"
            >
              {addKeyLoading ? (
                <>
                  <Loader2 size={12} className="spinner" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Key</span>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Keys List */}
      {keys.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-[var(--border-color)] rounded-lg">
          <KeyRound size={28} className="mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-xs font-semibold text-[var(--text-main)]">No API keys saved</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-1 mb-3">
            Add at least one Gemini API key to start messaging.
          </p>
          <button
            type="button"
            onClick={() => setIsAddingKey(true)}
            className="btn-primary text-xs py-1.5 px-3"
          >
            Add your first key
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {keys.map((k) => {
            const isChecking = checkingKeyId === k.id || k.healthStatus === 'checking';
            const modelsCount = k.models ? k.models.length : 0;

            // Health status tag
            let statusBadge = (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Healthy</span>
              </span>
            );

            if (isChecking) {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Loader2 size={10} className="spinner" />
                  <span>Checking</span>
                </span>
              );
            } else if (k.healthStatus === 'invalid' || k.state === 'invalid') {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={10} />
                  <span>Invalid</span>
                </span>
              );
            } else if (k.healthStatus === 'limited' || k.state === 'rate-limited') {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Clock size={10} />
                  <span>Limited</span>
                </span>
              );
            } else if (k.healthStatus === 'offline') {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/10 text-slate-500">
                  <WifiOff size={10} />
                  <span>Offline</span>
                </span>
              );
            }

            return (
              <div
                key={k.id}
                className="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] hover:border-[var(--border-focus)] transition-colors"
              >
                {/* Top line: Label + last4 + Status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {editingKeyId === k.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editingKeyLabel}
                          onChange={(e) => setEditingKeyLabel(e.target.value)}
                          className="text-xs py-0.5 px-1.5 border border-[var(--color-vermilion)] rounded bg-[var(--bg-surface)] text-[var(--text-main)] w-32"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(k.id);
                            if (e.key === 'Escape') setEditingKeyId(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveRename(k.id)}
                          className="btn-primary text-[10px] py-0.5 px-1.5"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingKeyId(null)}
                          className="btn-secondary text-[10px] py-0.5 px-1.5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="font-semibold text-xs text-[var(--text-main)] truncate">
                          {k.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKeyId(k.id);
                            setEditingKeyLabel(k.label);
                          }}
                          className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
                          title="Rename key"
                          aria-label={`Rename key ${k.label}`}
                        >
                          <Edit2 size={11} />
                        </button>
                      </>
                    )}
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">
                      ••••{k.last4}
                    </span>
                  </div>

                  <div className="shrink-0">{statusBadge}</div>
                </div>

                {/* Live telemetry row: response time, checked X ago, models count, last used */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-[var(--text-muted)]">
                  {k.responseTimeMs !== undefined && (
                    <span>{k.responseTimeMs}ms</span>
                  )}
                  <span>checked {formatTimeAgo(k.lastChecked)}</span>
                  <span>{modelsCount} model{modelsCount !== 1 ? 's' : ''}</span>
                  <span>Used: {formatTimeAgo(k.lastUsed)}</span>
                  <span>{k.requestCount || 0} reqs</span>
                </div>

                {/* Reason line if not healthy */}
                {k.errorMessage && (
                  <div className="mt-2 text-[11px] text-[var(--color-error)] bg-[var(--color-error-subtle)] p-1.5 rounded flex items-center justify-between">
                    <span className="truncate pr-2">{k.errorMessage}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setShowDetailsKeyId(showDetailsKeyId === k.id ? null : k.id)
                      }
                      className="text-[10px] underline shrink-0 hover:text-[var(--text-main)]"
                    >
                      {showDetailsKeyId === k.id ? 'Hide' : 'Details'}
                    </button>
                  </div>
                )}

                {showDetailsKeyId === k.id && k.errorMessage && (
                  <pre className="mt-1 text-[10px] font-mono bg-black/40 p-2 rounded text-[var(--text-muted)] overflow-x-auto whitespace-pre-wrap">
                    {k.errorMessage}
                  </pre>
                )}

                {/* Actions row: Check now, Rename, Delete */}
                <div className="flex items-center justify-end gap-1.5 mt-2.5 pt-2 border-t border-[var(--border-color)]">
                  <button
                    type="button"
                    onClick={() => handleCheckKey(k.id)}
                    disabled={isChecking}
                    className="btn-secondary text-[11px] py-0.5 px-2"
                  >
                    {isChecking ? (
                      <Loader2 size={11} className="spinner" />
                    ) : (
                      <RefreshCw size={11} />
                    )}
                    <span>Check now</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmDeleteKeyId(k.id)}
                    className="btn-danger-ghost text-[11px] py-0.5 px-2"
                    aria-label={`Delete ${k.label}`}
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Multiple keys notice */}
      {keys.length > 1 && (
        <div className="flex items-start gap-2 p-2.5 bg-[var(--bg-surface-hover)] rounded-md text-[11px] text-[var(--text-muted)]">
          <Info size={14} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
          <p>
            Multiple keys rotate automatically in turn. If a key hits a temporary quota or rate limit, Motion Studio automatically switches to the next available key with zero interruption.
          </p>
        </div>
      )}
    </div>
  );

  const renderModelsContent = () => (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-main)]">Default Model</h4>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Select which model starts new conversations. Auto automatically selects the fastest, highest-quality model available on your keys.
        </p>
      </div>

      <div className="p-3 bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded-lg">
        <label htmlFor="settings-default-model-select" className="block text-xs font-medium text-[var(--text-main)] mb-1.5">
          Active Default Model
        </label>
        <select
          id="settings-default-model-select"
          value={selectedModel}
          onChange={(e) => {
            onModelChange(e.target.value);
            db.settings.put({ key: 'selected_model', value: e.target.value });
          }}
          className="w-full text-xs py-1.5 px-2 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded text-[var(--text-main)] focus:outline-none focus:border-[var(--color-vermilion)]"
        >
          <option value={AUTO_MODEL_ID}>Auto (Best Model) — Recommended</option>
          {availableChatModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.id})
            </option>
          ))}
        </select>
      </div>

      {/* Models Per Key Read-Only Table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-[var(--text-main)]">Models Found Per Key</h4>
          <button
            type="button"
            onClick={handleCheckAll}
            disabled={isCheckingAll}
            className="btn-secondary text-[11px] py-1 px-2"
          >
            {isCheckingAll ? (
              <Loader2 size={11} className="spinner" />
            ) : (
              <RefreshCw size={11} />
            )}
            <span>Refresh</span>
          </button>
        </div>

        {keys.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No keys configured.</p>
        ) : (
          <div className="border border-[var(--border-color)] rounded-lg overflow-hidden text-xs">
            <div className="grid grid-cols-3 bg-[var(--bg-surface-hover)] px-3 py-2 font-semibold text-[var(--text-muted)] border-b border-[var(--border-color)]">
              <div>Key Label</div>
              <div>Status</div>
              <div className="text-right">Models Available</div>
            </div>
            {keys.map((k) => (
              <div
                key={k.id}
                className="grid grid-cols-3 px-3 py-2 border-b last:border-b-0 border-[var(--border-color)] items-center"
              >
                <div className="font-medium text-[var(--text-main)] truncate">
                  {k.label} (••••{k.last4})
                </div>
                <div>
                  <span className="capitalize text-[11px] text-[var(--text-muted)]">
                    {k.healthStatus || k.state}
                  </span>
                </div>
                <div className="text-right font-mono text-[var(--text-main)]">
                  {k.models ? k.models.length : 0}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderAppearanceContent = () => (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-main)]">Theme</h4>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Select your visual appearance. Dark Graphite is the native default.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            onThemeChange('dark');
            db.settings.put({ key: 'theme', value: 'dark' });
          }}
          className={`p-3 rounded-lg border text-left transition-all ${
            theme === 'dark'
              ? 'border-[var(--color-vermilion)] bg-[var(--bg-surface-hover)] shadow-sm'
              : 'border-[var(--border-color)] hover:border-[var(--border-focus)] bg-[var(--bg-surface)]'
          }`}
        >
          <div className="w-full h-14 rounded bg-[#18181b] border border-[#27272a] p-2 flex flex-col justify-between mb-2">
            <div className="w-12 h-1.5 bg-[#3f3f46] rounded" />
            <div className="w-20 h-1.5 bg-[#ff4f00] rounded" />
          </div>
          <div className="flex items-center gap-1.5">
            <Moon size={14} />
            <span className="text-xs font-medium text-[var(--text-main)]">Dark (Graphite)</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            onThemeChange('light');
            db.settings.put({ key: 'theme', value: 'light' });
          }}
          className={`p-3 rounded-lg border text-left transition-all ${
            theme === 'light'
              ? 'border-[var(--color-vermilion)] bg-[var(--bg-surface-hover)] shadow-sm'
              : 'border-[var(--border-color)] hover:border-[var(--border-focus)] bg-[var(--bg-surface)]'
          }`}
        >
          <div className="w-full h-14 rounded bg-[#f4f4f5] border border-[#e4e4e7] p-2 flex flex-col justify-between mb-2">
            <div className="w-12 h-1.5 bg-[#a1a1aa] rounded" />
            <div className="w-20 h-1.5 bg-[#ff4f00] rounded" />
          </div>
          <div className="flex items-center gap-1.5">
            <Sun size={14} />
            <span className="text-xs font-medium text-[var(--text-main)]">Light</span>
          </div>
        </button>
      </div>

      <div className="p-3 bg-[var(--bg-surface-hover)] rounded-md text-xs text-[var(--text-muted)] flex items-start gap-2">
        <Sparkles size={14} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
        <p>
          Motion Studio strictly respects system <code>prefers-reduced-motion</code> and high-contrast settings.
        </p>
      </div>
    </div>
  );

  const renderSecurityContent = () => (
    <div className="space-y-4">
      {/* Honest Notice */}
      <div className="p-3 bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded-lg text-xs leading-relaxed text-[var(--text-muted)]">
        <p className="font-semibold text-[var(--text-main)] mb-1 flex items-center gap-1.5">
          <Shield size={14} className="text-[var(--color-vermilion)]" />
          <span>Security Notice</span>
        </p>
        <p>
          Your keys are encrypted on this device and sent only to Google through this app’s secure routes, never stored on a server. Passphrase protection prevents keys from being extracted from browser storage without your phrase, but cannot protect against browser extensions with active webpage access.
        </p>
      </div>

      {/* Passphrase Form */}
      <div className="p-3 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-main)]">Session Passphrase</h4>
            <p className="text-[11px] text-[var(--text-muted)]">
              Status: {hasPassphrase ? (
                <span className="text-emerald-500 font-semibold">Enabled (PBKDF2 100k + AES-GCM)</span>
              ) : (
                <span className="text-[var(--text-muted)]">Disabled (Device Key)</span>
              )}
            </p>
          </div>
        </div>

        <form onSubmit={handleSavePassphrase} className="space-y-2.5">
          {hasPassphrase && (
            <div>
              <label htmlFor="settings-curr-pass" className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                Current Passphrase
              </label>
              <input
                id="settings-curr-pass"
                type="password"
                value={currentPassphraseInput}
                onChange={(e) => setCurrentPassphraseInput(e.target.value)}
                placeholder="Current passphrase"
                className="w-full text-xs py-1.5 px-2 bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded text-[var(--text-main)] focus:outline-none focus:border-[var(--color-vermilion)]"
                required
              />
            </div>
          )}

          <div>
            <label htmlFor="settings-new-pass" className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
              {hasPassphrase ? 'New Passphrase' : 'Set a Passphrase'}
            </label>
            <input
              id="settings-new-pass"
              type="password"
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              placeholder="Enter passphrase"
              className="w-full text-xs py-1.5 px-2 bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded text-[var(--text-main)] focus:outline-none focus:border-[var(--color-vermilion)]"
              required
            />
          </div>

          {passphraseError && (
            <div className="text-xs text-[var(--color-error)] bg-[var(--color-error-subtle)] p-2 rounded flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0" />
              <span>{passphraseError}</span>
            </div>
          )}

          {passphraseSuccess && (
            <div className="text-xs text-emerald-500 bg-emerald-500/10 p-2 rounded flex items-center gap-1.5">
              <Check size={13} className="shrink-0" />
              <span>{passphraseSuccess}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {hasPassphrase ? (
              <button
                type="button"
                onClick={handleRemovePassphrase}
                disabled={passphraseLoading}
                className="btn-danger-ghost text-xs py-1"
              >
                Remove passphrase
              </button>
            ) : <span />}

            <button
              type="submit"
              disabled={passphraseLoading || !passphraseInput.trim()}
              className="btn-primary text-xs py-1.5 px-3"
            >
              {passphraseLoading ? (
                <Loader2 size={12} className="spinner" />
              ) : (
                <span>{hasPassphrase ? 'Update Passphrase' : 'Save Passphrase'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderDataContent = () => (
    <div className="space-y-4">
      {/* Export Section */}
      <div className="p-3 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg flex items-center justify-between">
        <div>
          <h4 className="text-xs font-semibold text-[var(--text-main)]">Export Chat History</h4>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Download conversations and messages as JSON. API keys are strictly never exported.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportData}
          className="btn-secondary text-xs py-1.5 px-2.5 shrink-0"
        >
          <Download size={13} />
          <span>Export JSON</span>
        </button>
      </div>

      {/* Danger Zone */}
      <div className="mt-6 pt-4 border-t border-[var(--color-error)]/30 space-y-3">
        <h4 className="text-xs font-semibold text-[var(--color-error)] uppercase tracking-wider">
          Danger Zone
        </h4>

        {/* Remove all keys */}
        <div className="p-3 border border-[var(--color-error)]/20 rounded-lg bg-[var(--color-error-subtle)] flex items-center justify-between">
          <div>
            <h5 className="text-xs font-medium text-[var(--text-main)]">Remove all API keys</h5>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Wipes all stored encrypted keys from this browser.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmRemoveAllKeys(true)}
            disabled={keys.length === 0}
            className="btn-danger-ghost text-xs py-1 px-2.5 shrink-0"
          >
            <Trash2 size={12} />
            <span>Remove keys</span>
          </button>
        </div>

        {/* Delete all data */}
        <div className="p-3 border border-[var(--color-error)]/30 rounded-lg bg-[var(--color-error-subtle)] flex items-center justify-between">
          <div>
            <h5 className="text-xs font-medium text-[var(--color-error)]">Delete All Data</h5>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Permanently wipes all conversations, messages, settings, and vault keys.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDeleteAllData(true)}
            className="btn-danger text-xs py-1.5 px-2.5 shrink-0"
          >
            <Trash2 size={12} />
            <span>Delete everything</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-heading"
    >
      <div className="w-full h-full md:h-[650px] md:max-w-3xl bg-[var(--bg-surface)] border-0 md:border md:border-[var(--border-color)] md:rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Sticky Top Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0 bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2">
            {isMobile && mobileSubSection && (
              <button
                type="button"
                onClick={() => setMobileSubSection(null)}
                className="p-1 -ml-1 text-[var(--text-muted)] hover:text-[var(--text-main)] flex items-center gap-0.5 text-xs font-medium"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>
            )}
            <h2 id="settings-heading" className="font-semibold text-sm text-[var(--text-main)]">
              {isMobile && mobileSubSection
                ? mobileSubSection === 'keys'
                  ? 'API Keys'
                  : mobileSubSection === 'models'
                  ? 'Models & Defaults'
                  : mobileSubSection === 'appearance'
                  ? 'Appearance'
                  : mobileSubSection === 'security'
                  ? 'Privacy & Security'
                  : mobileSubSection === 'device-check'
                  ? 'Device Check'
                  : mobileSubSection === 'modules'
                  ? 'Modules'
                  : 'Data Management'
                : 'Settings'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon text-[var(--text-muted)] hover:text-[var(--text-main)]"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body: Split layout on Desktop, iOS-style navigation list on Phone */}
        {isMobile ? (
          <div className="flex-1 overflow-y-auto p-4">
            {!mobileSubSection ? (
              /* Phone Main Section List */
              <div className="space-y-1">
                {[
                  { id: 'keys' as TabType, label: 'API Keys', icon: KeyRound, desc: `${keys.length} key${keys.length !== 1 ? 's' : ''}` },
                  { id: 'models' as TabType, label: 'Models & Defaults', icon: Sliders, desc: selectedModel === AUTO_MODEL_ID ? 'Auto' : selectedModel },
                  { id: 'device-check' as TabType, label: 'Device Check', icon: Cpu, desc: 'Hardware & Encoders' },
                  { id: 'modules' as TabType, label: 'Modules', icon: Package, desc: 'Offline Bundles' },
                  { id: 'appearance' as TabType, label: 'Appearance', icon: theme === 'dark' ? Moon : Sun, desc: theme === 'dark' ? 'Dark' : 'Light' },
                  { id: 'security' as TabType, label: 'Privacy & Security', icon: Shield, desc: hasPassphrase ? 'Passphrase active' : 'Device key' },
                  { id: 'data' as TabType, label: 'Data Management', icon: Trash2, desc: 'Export & Wipe' },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMobileSubSection(item.id)}
                      className="w-full min-h-[44px] px-3 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] flex items-center justify-between text-left transition-colors mb-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-[var(--bg-surface-hover)] text-[var(--text-main)]">
                          <Icon size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[var(--text-main)]">{item.label}</p>
                          <p className="text-[11px] text-[var(--text-muted)]">{item.desc}</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-[var(--text-muted)]" />
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Phone Sub-Screen */
              <div>
                {mobileSubSection === 'keys' && renderKeysContent()}
                {mobileSubSection === 'models' && renderModelsContent()}
                {mobileSubSection === 'device-check' && <DeviceCheckTab />}
                {mobileSubSection === 'modules' && <ModulesTab />}
                {mobileSubSection === 'appearance' && renderAppearanceContent()}
                {mobileSubSection === 'security' && renderSecurityContent()}
                {mobileSubSection === 'data' && renderDataContent()}
              </div>
            )}
          </div>
        ) : (
          /* Desktop Split Layout: Left Navigation + Right Content Pane */
          <div className="flex flex-1 min-h-0">
            {/* Left Nav */}
            <div className="w-56 border-r border-[var(--border-color)] bg-[var(--bg-surface-hover)] p-3 space-y-1">
              {[
                { id: 'keys' as TabType, label: 'API Keys', icon: KeyRound, count: keys.length },
                { id: 'models' as TabType, label: 'Models & Defaults', icon: Sliders },
                { id: 'device-check' as TabType, label: 'Device Check', icon: Cpu },
                { id: 'modules' as TabType, label: 'Modules', icon: Package },
                { id: 'appearance' as TabType, label: 'Appearance', icon: theme === 'dark' ? Moon : Sun },
                { id: 'security' as TabType, label: 'Privacy & Security', icon: Shield },
                { id: 'data' as TabType, label: 'Data Management', icon: Trash2 },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                      isActive
                        ? 'bg-[var(--bg-surface)] text-[var(--color-vermilion)] border border-[var(--border-color)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon size={15} />
                      <span>{item.label}</span>
                    </div>
                    {item.count !== undefined && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--bg-surface-hover)] border border-[var(--border-color)]">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Right Content Pane */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'keys' && renderKeysContent()}
              {activeTab === 'models' && renderModelsContent()}
              {activeTab === 'device-check' && <DeviceCheckTab />}
              {activeTab === 'modules' && <ModulesTab />}
              {activeTab === 'appearance' && renderAppearanceContent()}
              {activeTab === 'security' && renderSecurityContent()}
              {activeTab === 'data' && renderDataContent()}
            </div>
          </div>
        )}

        {/* Nested Confirmation Dialogs */}
        {confirmDeleteKeyId && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg p-4 shadow-xl">
              <h4 className="text-xs font-semibold text-[var(--text-main)] mb-1">Delete this API key?</h4>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">
                This key will be permanently removed from your encrypted local storage.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteKeyId(null)}
                  className="btn-secondary text-xs py-1 px-2.5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteKey(confirmDeleteKeyId)}
                  className="btn-danger text-xs py-1 px-2.5"
                >
                  Delete Key
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmRemoveAllKeys && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg p-4 shadow-xl">
              <h4 className="text-xs font-semibold text-[var(--color-error)] mb-1">Remove all API keys?</h4>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">
                All saved keys will be wiped from this browser. You will need to add a key again to send messages.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRemoveAllKeys(false)}
                  className="btn-secondary text-xs py-1 px-2.5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRemoveAllKeys}
                  className="btn-danger text-xs py-1 px-2.5"
                >
                  Remove All Keys
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDeleteAllData && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--color-error)] rounded-lg p-4 shadow-xl">
              <h4 className="text-xs font-semibold text-[var(--color-error)] mb-1">Wipe All Local Data?</h4>
              <p className="text-[11px] text-[var(--text-muted)] mb-3">
                This will irreversibly delete all conversations, messages, settings, and encrypted keys from your browser’s IndexedDB.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAllData(false)}
                  className="btn-secondary text-xs py-1 px-2.5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAllData}
                  className="btn-danger text-xs py-1 px-2.5"
                >
                  Confirm &amp; Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
