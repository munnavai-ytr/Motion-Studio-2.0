'use client';

import React, { useState } from 'react';
import { Lock, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { unlockWithPassphrase } from '../lib/crypto';

interface PassphraseModalProps {
  onUnlocked: () => void;
}

export function PassphraseModal({ onUnlocked }: PassphraseModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) {
      setErrorMsg('Please enter your session passphrase.');
      return;
    }

    setVerifying(true);
    setErrorMsg(null);

    try {
      const success = await unlockWithPassphrase(passphrase);
      if (success) {
        onUnlocked();
      } else {
        setErrorMsg('Incorrect passphrase. Access denied.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to verify passphrase.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
      <div className="modal-card">
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-vermilion" />
            <h2 id="unlock-title" className="modal-title">Unlock Motion Studio</h2>
          </div>
        </div>

        <p className="modal-desc">
          Your local database is protected by an optional passphrase. Enter it to decrypt your API keys for this session.
        </p>

        <form onSubmit={handleSubmit} className="form-stack">
          <div className="form-group">
            <label htmlFor="session-passphrase" className="form-label">
              Passphrase
            </label>
            <div className="input-with-action">
              <input
                id="session-passphrase"
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter your passphrase"
                autoFocus
                className="form-input"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="input-inline-btn"
                aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="feedback-box feedback-error" role="alert">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="form-actions mt-4">
            <button
              type="submit"
              disabled={verifying || !passphrase.trim()}
              className="btn-primary w-full"
            >
              {verifying ? (
                <>
                  <Loader2 size={16} className="spinner" />
                  <span>Decrypting...</span>
                </>
              ) : (
                <span>Unlock Session</span>
              )}
            </button>
          </div>
        </form>

        <div className="passphrase-security-warning">
          <span>
            Notice: Passphrase encryption uses PBKDF2 (100,000 iterations) and AES-GCM to prevent unauthorized extraction from local disk storage.
          </span>
        </div>
      </div>
    </div>
  );
}
