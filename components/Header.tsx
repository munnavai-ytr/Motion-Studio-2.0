'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Menu,
  KeyRound,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  Sparkles,
  Loader2,
  Video,
} from 'lucide-react';
import {
  AUTO_MODEL_ID,
  getAutoBestModel,
  isKeyCoolingDownForModel,
  getModelCooldownSecondsLeft,
} from '../lib/gemini';
import { useCurrentTime } from '../lib/clock';
import type { StoredKey } from '../lib/types';

interface HeaderProps {
  conversationTitle: string;
  onOpenMobileMenu: () => void;
  onOpenSettings: () => void;
  onOpenModelPicker: () => void;
  onOpenStudio?: () => void;
  keys: StoredKey[];
  selectedModel: string;
}

export function Header({
  conversationTitle,
  onOpenMobileMenu,
  onOpenSettings,
  onOpenModelPicker,
  onOpenStudio,
  keys,
  selectedModel,
}: HeaderProps) {
  const currentTimestamp = useCurrentTime();

  const isAuto = !selectedModel || selectedModel === AUTO_MODEL_ID;

  // Determine effective model id to check readiness for
  const effectiveModelId = useMemo(() => {
    if (isAuto) {
      const best = getAutoBestModel(keys);
      return best ? best.id : 'gemini-2.5-flash';
    }
    return selectedModel.replace(/^models\//, '');
  }, [isAuto, selectedModel, keys]);

  // Compute live key status relative to the effective model
  const { statusType, statusText } = useMemo(() => {
    if (keys.length === 0) {
      return {
        statusType: 'none' as const,
        statusText: 'Add key',
      };
    }

    const validKeys = keys.filter((k) => k.state !== 'invalid');
    if (validKeys.length === 0) {
      return {
        statusType: 'invalid' as const,
        statusText: 'Fix keys',
      };
    }

    const isChecking = validKeys.some((k) => k.healthStatus === 'checking');
    if (isChecking && validKeys.every((k) => k.healthStatus === 'checking')) {
      return {
        statusType: 'checking' as const,
        statusText: 'Connecting...',
      };
    }

    // Filter keys supporting this model
    const supportingKeys = validKeys.filter(
      (k) => !k.models || k.models.length === 0 || k.models.some((m) => m.id === effectiveModelId)
    );

    const readyKeys = supportingKeys.filter((k) => !isKeyCoolingDownForModel(k, effectiveModelId));

    if (readyKeys.length > 0) {
      return {
        statusType: 'active' as const,
        statusText: `${readyKeys.length} key${readyKeys.length > 1 ? 's' : ''} ready`,
      };
    }

    // If all supporting keys are in cooldown for this model
    const cooldowns = supportingKeys
      .map((k) => {
        const cd = k.modelCooldowns?.[effectiveModelId];
        if (!cd || currentTimestamp >= cd) return 0;
        return Math.max(0, Math.ceil((cd - currentTimestamp) / 1000));
      })
      .filter((sec) => sec > 0);

    if (cooldowns.length > 0) {
      const minWait = Math.min(...cooldowns);
      return {
        statusType: 'rate-limited' as const,
        statusText: `Busy ${minWait}s`,
      };
    }

    return {
      statusType: 'active' as const,
      statusText: `${validKeys.length} ready`,
    };
  }, [keys, effectiveModelId, currentTimestamp]);

  const modelDisplayLabel = useMemo(() => {
    if (isAuto) {
      const best = getAutoBestModel(keys);
      return best ? `Auto · ${best.displayName}` : 'Auto · Best model';
    }
    return selectedModel.replace(/^models\//, '');
  }, [isAuto, selectedModel, keys]);

  return (
    <header className="app-top-header">
      <div className="header-left">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="btn-icon md:hidden"
          aria-label="Open conversation menu"
        >
          <Menu size={20} />
        </button>

        <h1 className="header-chat-title" title={conversationTitle}>
          {conversationTitle || 'Motion Studio'}
        </h1>
      </div>

      <div className="header-right flex items-center gap-2">
        {/* Studio Lab Trigger */}
        {onOpenStudio && (
          <button
            type="button"
            onClick={onOpenStudio}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-[#FF5B3A] hover:bg-[#E04B2C] text-white rounded-full shadow-sm transition-all"
            title="Open Video & Image Studio Lab"
          >
            <Video size={13} className="shrink-0" />
            <span className="hidden sm:inline">Studio Lab</span>
          </button>
        )}

        {/* Model Picker Pill Trigger */}
        <button
          type="button"
          onClick={onOpenModelPicker}
          className="header-model-pill flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface)] border border-[var(--border-color)] hover:border-[var(--border-focus)] rounded-full text-[var(--text-main)] transition-colors"
          title="Select Gemini Model"
          aria-label="Select Gemini Model"
        >
          {isAuto && <Sparkles size={13} className="text-[var(--color-vermilion)] shrink-0" />}
          <span className="truncate max-w-[140px] sm:max-w-[190px]">{modelDisplayLabel}</span>
          <ChevronDown size={13} className="text-[var(--text-muted)] shrink-0" />
        </button>

        {/* Live Key Health Status Pill */}
        <button
          type="button"
          onClick={onOpenSettings}
          className={`header-key-btn key-status-${statusType} flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-full transition-colors`}
          aria-label="Manage API keys"
          title={`Click to manage keys (${statusText})`}
        >
          {statusType === 'active' && <ShieldCheck size={14} className="text-emerald-500" />}
          {statusType === 'rate-limited' && <Clock size={14} className="text-amber-500" />}
          {statusType === 'invalid' && <AlertTriangle size={14} className="text-rose-500" />}
          {statusType === 'checking' && <Loader2 size={14} className="spinner text-[var(--color-vermilion)]" />}
          {statusType === 'none' && <KeyRound size={14} className="text-[var(--text-muted)]" />}

          <span className="header-key-text">{statusText}</span>
        </button>
      </div>
    </header>
  );
}
