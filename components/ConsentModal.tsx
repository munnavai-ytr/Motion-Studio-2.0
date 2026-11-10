'use client';

import React, { useState, useEffect } from 'react';
import {
  PackageCheck,
  DownloadCloud,
  X,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { installModule } from '../lib/moduleManager';
import { checkDeviceCapabilities, formatBytes } from '../lib/deviceCheck';
import type { ModuleDefinition } from '../lib/types';

interface ConsentModalProps {
  isOpen: boolean;
  missingModules: ModuleDefinition[];
  onClose: () => void;
  onSuccess: () => void;
}

export function ConsentModal({
  isOpen,
  missingModules,
  onClose,
  onSuccess,
}: ConsentModalProps) {
  const [installing, setInstalling] = useState(false);
  const [currentModuleIndex, setCurrentModuleIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkDeviceCapabilities().then((res) => {
        setFreeSpace(res.storage.freeBytes || null);
      });
    }
  }, [isOpen]);

  if (!isOpen || missingModules.length === 0) return null;

  const totalBytes = missingModules.reduce(
    (acc, m) => acc + m.files.reduce((fAcc, f) => fAcc + f.sizeBytes, 0),
    0
  );

  const handleStartInstall = async () => {
    try {
      setInstalling(true);
      setErrorMsg(null);

      for (let i = 0; i < missingModules.length; i++) {
        setCurrentModuleIndex(i);
        const mod = missingModules[i];
        await installModule(mod.id, (percent) => {
          setProgressPercent(percent);
        });
      }

      onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Download failed. Please check network connection.');
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#FF5B3A]/10 text-[#FF5B3A]">
              <PackageCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">One-Time Module Setup</h3>
              <p className="text-xs text-neutral-400">স্টুডিও মডিউল ডাউনলোড ও সংরক্ষণ</p>
            </div>
          </div>
          {!installing && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <p className="text-xs text-neutral-300 leading-relaxed">
          To synthesize videos and render graphics purely on your device without sending assets to a server, Motion Studio needs to cache the following modules locally. You will only download them once.
        </p>

        {/* Missing Modules Table */}
        <div className="bg-neutral-950/60 rounded-xl border border-neutral-800 divide-y divide-neutral-800/80">
          {missingModules.map((m, idx) => {
            const mBytes = m.files.reduce((acc, f) => acc + f.sizeBytes, 0);
            const isDownloading = installing && currentModuleIndex === idx;
            const isDone = installing && currentModuleIndex > idx;

            return (
              <div key={m.id} className="p-3 flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <div className="font-medium text-white flex items-center gap-1.5">
                    {m.name}
                    {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  {m.nameBn && <div className="text-[11px] text-neutral-400">{m.nameBn}</div>}
                </div>
                <div className="text-right">
                  <div className="font-mono text-neutral-300">{formatBytes(mBytes)}</div>
                  {isDownloading && (
                    <div className="text-[10px] text-[#FF5B3A] animate-pulse">
                      {progressPercent}%
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Storage stats */}
        <div className="p-3 bg-neutral-850/60 rounded-xl border border-neutral-800 flex items-center justify-between text-xs">
          <div className="space-y-0.5">
            <span className="text-neutral-400">Total Download:</span>
            <div className="font-mono text-white font-semibold">{formatBytes(totalBytes)}</div>
          </div>
          {freeSpace !== null && (
            <div className="text-right space-y-0.5">
              <span className="text-neutral-400">Free Space on Device:</span>
              <div className="font-mono text-emerald-400 font-semibold">{formatBytes(freeSpace)}</div>
            </div>
          )}
        </div>

        {/* Progress bar during install */}
        {installing && (
          <div className="space-y-1.5">
            <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#FF5B3A] h-full rounded-full transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-neutral-400">
              <span>
                Installing {currentModuleIndex + 1} of {missingModules.length} modules...
              </span>
              <span>{progressPercent}%</span>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          {!installing && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleStartInstall}
            disabled={installing}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-[#FF5B3A] hover:bg-[#E04B2C] rounded-xl transition-colors disabled:opacity-50"
          >
            {installing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Installing Modules...
              </>
            ) : (
              <>
                <DownloadCloud className="w-3.5 h-3.5" />
                Install ({formatBytes(totalBytes)})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
