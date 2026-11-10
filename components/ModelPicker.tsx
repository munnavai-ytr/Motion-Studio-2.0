'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles,
  Search,
  Check,
  Clock,
  KeyRound,
  Loader2,
  X,
  AlertCircle,
} from 'lucide-react';
import { AUTO_MODEL_ID, getAvailableChatModels, getAutoBestModel, isModelBusyAcrossAllKeys } from '../lib/gemini';
import { useCurrentTime } from '../lib/clock';
import type { KeyModelInfo, StoredKey } from '../lib/types';

interface ModelPickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  keys: StoredKey[];
  onOpenSettings: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function ModelPicker({
  isOpen,
  onClose,
  selectedModel,
  onSelectModel,
  keys,
  onOpenSettings,
}: ModelPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const currentTimestamp = useCurrentTime();
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Detect mobile viewport (< 768px)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close on Escape & focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Aggregate models from user's keys
  const { chatModels, nonChatCount, isCheckingKeys } = useMemo(() => {
    const validKeys = keys.filter((k) => k.state !== 'invalid');
    const isChecking = validKeys.some((k) => k.healthStatus === 'checking');

    const availableChat = getAvailableChatModels(keys);

    let otherCount = 0;
    const allSeen = new Set<string>();
    for (const k of validKeys) {
      for (const m of k.models || []) {
        if (!allSeen.has(m.id)) {
          allSeen.add(m.id);
          if (m.category !== 'chat') otherCount++;
        }
      }
    }

    return {
      chatModels: availableChat,
      nonChatCount: otherCount,
      isCheckingKeys: isChecking,
    };
  }, [keys]);

  const autoBest = useMemo(() => getAutoBestModel(keys), [keys]);

  // Filter models by search query
  const filteredChatModels = useMemo(() => {
    if (!searchQuery.trim()) return chatModels;
    const q = searchQuery.toLowerCase();
    return chatModels.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q))
    );
  }, [chatModels, searchQuery]);

  if (!isOpen) return null;

  const isAutoSelected = !selectedModel || selectedModel === AUTO_MODEL_ID;

  return (
    <div
      className="model-picker-backdrop fixed inset-0 z-50 flex items-end md:items-center md:justify-center bg-black/50 backdrop-blur-[2px] transition-opacity duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Select Gemini Model"
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className={`model-picker-surface w-full md:max-w-md bg-[var(--bg-surface)] border border-[var(--border-color)] shadow-2xl rounded-t-2xl md:rounded-xl overflow-hidden flex flex-col max-h-[85vh] md:max-h-[700px] transition-all duration-150 ${
          isMobile ? 'animate-in slide-in-from-bottom' : 'animate-in fade-in zoom-in-95'
        }`}
      >
        {/* Mobile Grab Handle */}
        <div className="md:hidden flex justify-center pt-2.5 pb-1 cursor-grab">
          <div className="w-10 h-1 bg-[var(--border-color)] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-main)]">Gemini Models</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {keys.length === 0
                ? 'No keys configured'
                : `${chatModels.length} chat models available on your keys`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon text-[var(--text-muted)] hover:text-[var(--text-main)]"
            aria-label="Close model picker"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search input (shown when more than 6 models) */}
        {chatModels.length > 6 && (
          <div className="px-3 pt-3 pb-1 border-b border-[var(--border-color)] bg-[var(--bg-surface)]">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-2.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded-md text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--color-vermilion)] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Model Selection List */}
        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {/* Top: Auto (Best Model) Card */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              onSelectModel(AUTO_MODEL_ID);
              onClose();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectModel(AUTO_MODEL_ID);
                onClose();
              }
            }}
            className={`w-full p-3 rounded-lg border text-left cursor-pointer transition-all duration-150 flex items-start justify-between min-h-[44px] ${
              isAutoSelected
                ? 'border-[var(--color-vermilion)] bg-[var(--bg-surface-hover)] shadow-sm'
                : 'border-[var(--border-color)] hover:border-[var(--border-focus)] bg-[var(--bg-surface)]'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-md bg-[var(--color-vermilion-subtle)] text-[var(--color-vermilion)] shrink-0 mt-0.5">
                <Sparkles size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-[var(--text-main)]">Auto</span>
                  <span className="text-[11px] font-medium text-[var(--color-vermilion)] bg-[var(--color-vermilion-subtle)] px-1.5 py-0.2 rounded">
                    Best model
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
                  Automatically routes to the highest-performing available model and switches on cooldowns.
                </p>
                {autoBest && (
                  <p className="text-[11px] font-mono text-[var(--text-main)] mt-1.5">
                    Currently: <span className="font-semibold">{autoBest.displayName}</span>
                  </p>
                )}
              </div>
            </div>

            {isAutoSelected && (
              <Check size={16} className="text-[var(--color-vermilion)] shrink-0 mt-1" />
            )}
          </div>

          {/* Section Divider */}
          <div className="pt-2 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] px-1">
              Chat Models
            </span>
          </div>

          {/* Empty state: No keys */}
          {keys.length === 0 && (
            <div className="p-6 text-center border border-dashed border-[var(--border-color)] rounded-lg">
              <KeyRound size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
              <p className="text-xs font-semibold text-[var(--text-main)]">No API keys configured</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1 mb-3">
                Add your Gemini API key to discover the models available on your account.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Configure Keys in Settings
              </button>
            </div>
          )}

          {/* Empty state: Keys checking */}
          {keys.length > 0 && chatModels.length === 0 && isCheckingKeys && (
            <div className="p-6 text-center border border-[var(--border-color)] rounded-lg">
              <Loader2 size={20} className="spinner mx-auto text-[var(--color-vermilion)] mb-2" />
              <p className="text-xs text-[var(--text-main)]">Connecting to Gemini...</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Fetching models available on your configured keys.
              </p>
            </div>
          )}

          {/* Empty state: No models returned */}
          {keys.length > 0 && chatModels.length === 0 && !isCheckingKeys && (
            <div className="p-6 text-center border border-[var(--border-color)] rounded-lg">
              <AlertCircle size={20} className="mx-auto text-[var(--color-error)] mb-2" />
              <p className="text-xs text-[var(--text-main)]">No chat models found</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Your keys did not return any models with content generation capabilities.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="btn-secondary text-xs mt-3 py-1.5"
              >
                Check API Keys
              </button>
            </div>
          )}

          {/* Chat models list */}
          {filteredChatModels.map((model) => {
            const isSelected = !isAutoSelected && selectedModel === model.id;
            const { isBusy, minSecondsLeft } = isModelBusyAcrossAllKeys(keys, model.id);

            return (
              <div
                key={model.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelectModel(model.id);
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectModel(model.id);
                    onClose();
                  }
                }}
                className={`w-full p-2.5 rounded-lg border text-left cursor-pointer transition-all duration-150 flex items-center justify-between min-h-[44px] ${
                  isSelected
                    ? 'border-[var(--color-vermilion)] bg-[var(--bg-surface-hover)] shadow-sm'
                    : 'border-[var(--border-color)] hover:border-[var(--border-focus)] bg-[var(--bg-surface)]'
                }`}
              >
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-xs text-[var(--text-main)] truncate">
                      {model.displayName}
                    </span>

                    {/* Badges */}
                    {model.isFast && (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium px-1.5 py-0.2 rounded">
                        Fast
                      </span>
                    )}
                    {model.isLite && (
                      <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium px-1.5 py-0.2 rounded">
                        Lite
                      </span>
                    )}
                    {model.isPro && (
                      <span className="text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 font-medium px-1.5 py-0.2 rounded">
                        Pro
                      </span>
                    )}
                    {model.isPreview && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium px-1.5 py-0.2 rounded">
                        Preview
                      </span>
                    )}

                    {/* Busy Tag */}
                    {isBusy && (
                      <span className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono flex items-center gap-1 px-1.5 py-0.2 rounded">
                        <Clock size={10} />
                        <span>Busy {minSecondsLeft}s</span>
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5 truncate">
                    {model.id}
                  </p>
                </div>

                {isSelected && (
                  <Check size={16} className="text-[var(--color-vermilion)] shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        {/* Footnote for image & voice models */}
        {nonChatCount > 0 && (
          <div className="px-4 py-2.5 bg-[var(--bg-surface-hover)] border-t border-[var(--border-color)]">
            <p className="text-[11px] text-[var(--text-muted)] text-center">
              {nonChatCount} image and voice models found on your keys. They unlock in Studio tools.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
