'use client';

import React, { useState } from 'react';
import { ExternalLink, KeyRound, Eye, EyeOff, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { addNewKey } from '../lib/gemini';

interface OnboardingModalProps {
  onKeyAdded: () => void;
}

export function OnboardingModal({ onKeyAdded }: OnboardingModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      setErrorMsg('Please enter a valid Gemini API key.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    try {
      // Direct save without manual test first step: encrypts and saves immediately, runs background health check
      await addNewKey(cleanKey, label.trim() || undefined);
      onKeyAdded();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save encrypted key.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="modal-card onboarding-card max-w-md">
        <div className="onboarding-badge">
          <KeyRound size={16} className="text-[var(--color-vermilion)]" />
          <span>Bring Your Own Key (BYOK)</span>
        </div>

        <h2 id="onboarding-title" className="onboarding-headline text-lg font-semibold mt-2 mb-1">
          Welcome to Motion Studio
        </h2>

        <p className="onboarding-desc text-xs text-[var(--text-muted)] leading-relaxed mb-4">
          Each user provides their own Gemini API key. Your keys are encrypted on this device and sent only to Google through this app’s secure routes, never stored on a server.
        </p>

        <div className="p-3 bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded-lg text-xs space-y-2 mb-4">
          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-[var(--color-vermilion-subtle)] text-[var(--color-vermilion)] flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
              1
            </span>
            <div>
              <p className="text-[var(--text-muted)]">Get a free or pay-as-you-go key from Google:</p>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[var(--color-vermilion)] font-medium mt-0.5 hover:underline"
              >
                <span>Google AI Studio API Keys</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-[var(--color-vermilion-subtle)] text-[var(--color-vermilion)] flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
              2
            </span>
            <p className="text-[var(--text-muted)]">
              Paste your key below. It saves immediately into local storage and connects in the background.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label htmlFor="apiKey" className="block text-xs font-medium text-[var(--text-main)] mb-1">
              Gemini API Key <span className="text-[var(--color-vermilion)]">*</span>
            </label>
            <div className="relative flex items-center">
              <input
                id="apiKey"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                autoComplete="off"
                spellCheck="false"
                required
                autoFocus
                className="w-full text-xs py-2 pl-3 pr-8 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-md text-[var(--text-main)] focus:outline-none focus:border-[var(--color-vermilion)]"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="keyLabel" className="block text-xs font-medium text-[var(--text-main)] mb-1">
              Key Label <span className="text-[var(--text-muted)] font-normal">(optional)</span>
            </label>
            <input
              id="keyLabel"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Personal, Work, Pro"
              className="w-full text-xs py-2 px-3 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-md text-[var(--text-main)] focus:outline-none focus:border-[var(--color-vermilion)]"
            />
          </div>

          {errorMsg && (
            <div className="text-xs text-[var(--color-error)] bg-[var(--color-error-subtle)] p-2 rounded flex items-center gap-1.5">
              <AlertCircle size={14} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving || !apiKey.trim()}
              className="btn-primary w-full py-2 text-xs font-semibold justify-center"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="spinner" />
                  <span>Saving &amp; Connecting...</span>
                </>
              ) : (
                <span>Save Key &amp; Enter Studio</span>
              )}
            </button>
          </div>
        </form>

        <div className="mt-4 pt-3 border-t border-[var(--border-color)] flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <ShieldCheck size={14} className="shrink-0 text-[var(--text-muted)]" />
          <span>AES-GCM encrypted in browser IndexedDB. Zero server-side persistence.</span>
        </div>
      </div>
    </div>
  );
}
