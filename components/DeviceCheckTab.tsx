'use client';

import React, { useState, useEffect } from 'react';
import {
  Cpu,
  HardDrive,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  Video,
  Layers,
  Sparkles,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { checkDeviceCapabilities, formatBytes } from '../lib/deviceCheck';
import type { DeviceCheckResult, SupportStatus } from '../lib/types';

export function DeviceCheckTab() {
  const [loading, setLoading] = useState<boolean>(true);
  const [result, setResult] = useState<DeviceCheckResult | null>(null);

  const runCheck = async () => {
    setLoading(true);
    try {
      const res = await checkDeviceCapabilities();
      setResult(res);
    } catch (e) {
      console.error('Device check error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    checkDeviceCapabilities().then((res) => {
      if (active) {
        setResult(res);
        setLoading(false);
      }
    }).catch(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const renderBadge = (status: SupportStatus, label?: string) => {
    if (status === 'supported') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {label || 'Supported'}
        </span>
      );
    }
    if (status === 'not-supported') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <XCircle className="w-3.5 h-3.5" />
          {label || 'Not supported'}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <HelpCircle className="w-3.5 h-3.5" />
        {label || 'Unknown'}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#FF5B3A]" />
            Device & Hardware Capabilities
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Real hardware detection to determine your local video synthesis path.
          </p>
        </div>
        <button
          onClick={runCheck}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Re-test
        </button>
      </div>

      {loading && !result ? (
        <div className="p-8 text-center bg-neutral-900/60 rounded-xl border border-neutral-800">
          <RefreshCw className="w-6 h-6 animate-spin text-[#FF5B3A] mx-auto mb-2" />
          <p className="text-xs text-neutral-400">Measuring hardware encoders and storage APIs...</p>
        </div>
      ) : result ? (
        <div className="space-y-4">
          {/* Active Render Path Banner */}
          <div className="p-4 rounded-xl border bg-gradient-to-r from-neutral-900 to-neutral-850 border-neutral-800 flex items-start gap-3.5">
            <div className="p-2 rounded-lg bg-[#FF5B3A]/10 text-[#FF5B3A] mt-0.5">
              <Zap className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold tracking-wider text-neutral-400 uppercase">
                  Active Synthesis Engine
                </span>
                {result.recommendedRenderPath === 'webcodecs-h264' ? (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Path A • High Performance
                  </span>
                ) : result.recommendedRenderPath === 'mediarecorder-fallback' ? (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    Path B • Realtime Fallback
                  </span>
                ) : (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">
                    Unsupported
                  </span>
                )}
              </div>
              <h4 className="text-sm font-semibold text-white mt-1">
                {result.recommendedRenderPath === 'webcodecs-h264'
                  ? 'Hardware-Accelerated WebCodecs (H.264 MP4)'
                  : result.recommendedRenderPath === 'mediarecorder-fallback'
                  ? `Canvas CaptureStream Fallback (${result.mediaRecorderMimeType || 'video/webm'})`
                  : 'Video rendering unsupported on this browser'}
              </h4>
              <p className="text-xs text-neutral-400 mt-1">
                {result.recommendedRenderPath === 'webcodecs-h264'
                  ? 'Your browser supports hardware H.264 video encoding with OffscreenCanvas. Videos render frame-accurate at full speed without dropping frames.'
                  : result.recommendedRenderPath === 'mediarecorder-fallback'
                  ? 'WebCodecs H.264 is unavailable or restricted. Rendering uses MediaRecorder with canvas stream capture.'
                  : 'Neither WebCodecs nor MediaRecorder is available. Image export is still available.'}
              </p>
            </div>
          </div>

          {/* Video Encoders List */}
          <div className="bg-neutral-900/60 rounded-xl border border-neutral-800 divide-y divide-neutral-800">
            <div className="p-3.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white flex items-center gap-2">
                  <Video className="w-3.5 h-3.5 text-neutral-400" />
                  WebCodecs H.264 (720p @ 30fps)
                </div>
                <div className="text-[11px] text-neutral-500">
                  Profile AVC1.4D001F • Main 3.1
                </div>
              </div>
              {renderBadge(result.webCodecsH264_720p)}
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white flex items-center gap-2">
                  <Video className="w-3.5 h-3.5 text-neutral-400" />
                  WebCodecs H.264 (1080p @ 30fps)
                </div>
                <div className="text-[11px] text-neutral-500">
                  Profile AVC1.4D0028 • Main 4.0
                </div>
              </div>
              {renderBadge(result.webCodecsH264_1080p)}
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-neutral-400" />
                  OffscreenCanvas
                </div>
                <div className="text-[11px] text-neutral-500">
                  Background worker 2D canvas synthesis
                </div>
              </div>
              {renderBadge(result.offscreenCanvas)}
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-neutral-400" />
                  Dedicated Web Workers
                </div>
                <div className="text-[11px] text-neutral-500">
                  Background thread execution without UI blocking
                </div>
              </div>
              {renderBadge(result.webWorkers)}
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white flex items-center gap-2">
                  <Video className="w-3.5 h-3.5 text-neutral-400" />
                  MediaRecorder Fallback
                </div>
                <div className="text-[11px] text-neutral-500">
                  {result.mediaRecorderMimeType || 'canvas.captureStream stream recorder'}
                </div>
              </div>
              {renderBadge(result.mediaRecorderFallback)}
            </div>
          </div>

          {/* Storage & Persistence Section */}
          <div className="bg-neutral-900/60 rounded-xl border border-neutral-800 p-4 space-y-3.5">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <HardDrive className="w-3.5 h-3.5 text-[#FF5B3A]" />
              Storage & Persistence
            </h4>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">Used Storage:</span>
                <span className="font-mono text-white font-medium">
                  {formatBytes(result.storage.usageBytes || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">Available Free Space:</span>
                <span className="font-mono text-emerald-400 font-medium">
                  {formatBytes(result.storage.freeBytes || 0)}
                </span>
              </div>
              {result.storage.quotaBytes ? (
                <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden mt-1">
                  <div
                    className="bg-[#FF5B3A] h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(1, ((result.storage.usageBytes || 0) / result.storage.quotaBytes) * 100)
                      )}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>

            <div className="pt-2 border-t border-neutral-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-neutral-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Persistent Storage:
              </div>
              <span className={`font-medium ${result.storage.persisted ? 'text-emerald-400' : 'text-neutral-400'}`}>
                {result.storage.persisted ? 'Granted (Protected)' : 'Standard (Best Effort)'}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
