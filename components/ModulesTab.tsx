'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RefreshCw,
  HardDrive,
  ShieldCheck,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  getModulesManifest,
  getStoredModules,
  installModule,
  uninstallModule,
} from '../lib/moduleManager';
import { formatBytes } from '../lib/deviceCheck';
import type { StoredModule, ModuleDefinition } from '../lib/types';

export function ModulesTab() {
  const [modules, setModules] = useState<StoredModule[]>([]);
  const [manifestDefs, setManifestDefs] = useState<ModuleDefinition[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<{ [id: string]: number }>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const manifest = await getModulesManifest();
      setManifestDefs(manifest.modules);
      const stored = await getStoredModules();
      setModules(stored);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to load modules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getModulesManifest(), getStoredModules()])
      .then(([manifest, stored]) => {
        if (active) {
          setManifestDefs(manifest.modules);
          setModules(stored);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (active) {
          setErrorMsg(e.message || 'Failed to load modules');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleInstall = async (id: string) => {
    try {
      setInstallingId(id);
      setErrorMsg(null);
      await installModule(id, (percent) => {
        setInstallProgress((prev) => ({ ...prev, [id]: percent }));
      });
      await loadData();
    } catch (e: any) {
      setErrorMsg(e.message || 'Installation failed');
      await loadData();
    } finally {
      setInstallingId(null);
    }
  };

  const handleInstallAll = async () => {
    const uninstalled = modules.filter(
      (m) => m.status === 'not-installed' || m.status === 'error' || m.status === 'update-available'
    );
    for (const mod of uninstalled) {
      await handleInstall(mod.id);
    }
  };

  const handleUninstall = async (id: string) => {
    try {
      await uninstallModule(id);
      await loadData();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to uninstall');
    }
  };

  const totalInstalledBytes = modules
    .filter((m) => m.status === 'installed')
    .reduce((acc, m) => acc + m.sizeBytes, 0);

  const allInstalled = modules.length > 0 && modules.every((m) => m.status === 'installed');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Package className="w-4 h-4 text-[#FF5B3A]" />
            Local Studio Modules
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Heavy libraries stored locally on your device once. Zero network during rendering.
          </p>
        </div>
        {!allInstalled && (
          <button
            onClick={handleInstallAll}
            disabled={installingId !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FF5B3A] hover:bg-[#E04B2C] text-white transition-colors disabled:opacity-50"
          >
            <DownloadCloud className="w-3.5 h-3.5" />
            Install All Missing
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {loading && modules.length === 0 ? (
        <div className="p-8 text-center bg-neutral-900/60 rounded-xl border border-neutral-800">
          <RefreshCw className="w-6 h-6 animate-spin text-[#FF5B3A] mx-auto mb-2" />
          <p className="text-xs text-neutral-400">Loading module status...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {modules.map((mod) => {
            const isCurrentInstalling = installingId === mod.id;
            const progress = installProgress[mod.id] ?? mod.progressPercent ?? 0;

            return (
              <div
                key={mod.id}
                className="p-4 rounded-xl border bg-neutral-900/60 border-neutral-800 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{mod.name}</span>
                      <span className="text-xs font-mono text-neutral-400 px-1.5 py-0.5 rounded bg-neutral-800">
                        v{mod.version}
                      </span>
                      <span className="text-xs font-mono text-neutral-400">
                        {formatBytes(mod.sizeBytes)}
                      </span>
                    </div>
                    {mod.nameBn && (
                      <div className="text-xs text-neutral-300 font-medium">{mod.nameBn}</div>
                    )}
                    <p className="text-xs text-neutral-400">{mod.purpose}</p>
                  </div>

                  <div>
                    {mod.status === 'installed' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Installed
                      </span>
                    ) : mod.status === 'downloading' || isCurrentInstalling ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Downloading ({progress}%)
                      </span>
                    ) : mod.status === 'verifying' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30">
                        <ShieldCheck className="w-3.5 h-3.5 animate-pulse" />
                        Verifying SHA-256
                      </span>
                    ) : mod.status === 'update-available' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                        <DownloadCloud className="w-3.5 h-3.5" />
                        Update Available
                      </span>
                    ) : mod.status === 'error' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Error
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
                        Not Installed
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar if downloading */}
                {(isCurrentInstalling || mod.status === 'downloading') && (
                  <div className="space-y-1">
                    <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-[#FF5B3A] h-full rounded-full transition-all duration-200"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                      <span>{progress}% complete</span>
                      <span>Verified with SHA-256</span>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <div className="text-[11px] text-neutral-400">
                    Required for: <span className="text-neutral-300 font-medium capitalize">{mod.requiredFor}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {mod.status === 'installed' ? (
                      <>
                        <button
                          onClick={() => handleInstall(mod.id)}
                          disabled={installingId !== null}
                          className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-750 text-neutral-300 transition-colors disabled:opacity-50"
                        >
                          Re-verify
                        </button>
                        <button
                          onClick={() => handleUninstall(mod.id)}
                          disabled={installingId !== null}
                          className="p-1 rounded text-neutral-400 hover:text-rose-400 transition-colors disabled:opacity-50"
                          title="Remove from local cache"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleInstall(mod.id)}
                        disabled={installingId !== null}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-semibold bg-[#FF5B3A] hover:bg-[#E04B2C] text-white transition-colors disabled:opacity-50"
                      >
                        <DownloadCloud className="w-3.5 h-3.5" />
                        {mod.status === 'update-available' ? 'Update' : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Storage summary */}
      <div className="p-3 bg-neutral-900/40 rounded-xl border border-neutral-800 flex items-center justify-between text-xs text-neutral-400">
        <span className="flex items-center gap-2">
          <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
          Total Module Storage:
        </span>
        <span className="font-mono text-white font-medium">
          {formatBytes(totalInstalledBytes)}
        </span>
      </div>
    </div>
  );
}
