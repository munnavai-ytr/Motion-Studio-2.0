'use client';

import React, { useState, useEffect } from 'react';
import { Package, DownloadCloud, X, CheckCircle2 } from 'lucide-react';
import { checkMissingModules, installModule } from '../lib/moduleManager';
import { formatBytes } from '../lib/deviceCheck';
import type { ModuleDefinition } from '../lib/types';

interface PrepareStudioCardProps {
  onOpenModulesModal?: () => void;
}

export function PrepareStudioCard({ onOpenModulesModal }: PrepareStudioCardProps) {
  const [missing, setMissing] = useState<ModuleDefinition[]>([]);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('motion_studio_prepare_dismissed') === 'true';
    }
    return false;
  });
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installedCount, setInstalledCount] = useState(0);

  useEffect(() => {
    let active = true;
    checkMissingModules('both')
      .then((mods) => {
        if (active) setMissing(mods);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (dismissed || missing.length === 0) return null;

  const totalBytes = missing.reduce(
    (acc, m) => acc + m.files.reduce((fAcc, f) => fAcc + f.sizeBytes, 0),
    0
  );

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('motion_studio_prepare_dismissed', 'true');
    }
  };

  const handlePreInstall = async () => {
    setInstalling(true);
    try {
      for (let i = 0; i < missing.length; i++) {
        await installModule(missing[i].id, (percent) => setProgress(percent));
        setInstalledCount(i + 1);
      }
      setMissing([]);
      handleDismiss();
    } catch {
      setInstalling(false);
    }
  };

  return (
    <div className="relative mx-4 mb-4 p-4 rounded-2xl bg-gradient-to-r from-neutral-900 to-neutral-850 border border-neutral-800 shadow-lg">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 rounded-lg text-neutral-400 hover:text-white transition-colors"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3.5 pr-8">
        <div className="p-2.5 rounded-xl bg-[#FF5B3A]/10 text-[#FF5B3A] shrink-0">
          <Package className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-white">Prepare the Studio (Offline Modules)</h4>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
              {formatBytes(totalBytes)}
            </span>
          </div>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Pre-cache video and font modules now for instant offline motion rendering. Fully client-side; zero cloud costs.
          </p>

          {installing ? (
            <div className="pt-2 space-y-1.5">
              <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#FF5B3A] h-full rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-neutral-400">
                <span>Installing {installedCount} of {missing.length} modules...</span>
                <span>{progress}%</span>
              </div>
            </div>
          ) : (
            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={handlePreInstall}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FF5B3A] hover:bg-[#E04B2C] text-white transition-colors"
              >
                <DownloadCloud className="w-3.5 h-3.5" />
                Pre-install Modules
              </button>
              {onOpenModulesModal && (
                <button
                  onClick={onOpenModulesModal}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-750 transition-colors"
                >
                  View Details
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
