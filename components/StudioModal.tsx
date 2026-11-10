'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Video,
  Image as ImageIcon,
  Play,
  Pause,
  RotateCcw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Sliders,
  Maximize2,
  FileCode,
  Layers,
  Zap,
  RefreshCw,
  Camera,
  Check,
  ChevronRight,
  Loader2,
  Clock,
} from 'lucide-react';
import { SAMPLE_TEMPLATES } from '../lib/sceneEngine/templates';
import { validateScene } from '../lib/sceneEngine/validator';
import { renderScene } from '../lib/sceneEngine/renderer';
import {
  renderVideoWebCodecs,
  renderVideoMediaRecorder,
  renderStillPng,
  type RenderProgress,
} from '../lib/videoRenderer';
import { checkDeviceCapabilities } from '../lib/deviceCheck';
import { checkMissingModules, loadModuleScript } from '../lib/moduleManager';
import { ConsentModal } from './ConsentModal';
import { db } from '../lib/db';
import type { Scene, StoredFile, ModuleDefinition, DeviceCheckResult } from '../lib/types';

interface StudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeKeySecret?: string;
}

export function StudioModal({ isOpen, onClose, activeKeySecret }: StudioModalProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'image'>('video');

  // Scene state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(SAMPLE_TEMPLATES[0].id!);
  const [sceneJsonText, setSceneJsonText] = useState<string>(() =>
    JSON.stringify(SAMPLE_TEMPLATES[0], null, 2)
  );
  const [currentScene, setCurrentScene] = useState<Scene>(SAMPLE_TEMPLATES[0]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isLooping, setIsLooping] = useState<boolean>(true);

  // Video Rendering state
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Image Lab state
  const [imageTab, setImageTab] = useState<'export' | 'gemini'>('export');
  const [exportAspectRatio, setExportAspectRatio] = useState<'1:1' | '4:5' | '9:16' | '16:9'>('16:9');
  const [geminiPrompt, setGeminiPrompt] = useState<string>('');
  const [geminiAspectRatio, setGeminiAspectRatio] = useState<'1:1' | '3:4' | '4:3' | '9:16' | '16:9'>('1:1');
  const [geminiModel, setGeminiModel] = useState<string>('imagen-3.0-generate-002');
  const [isGeneratingGemini, setIsGeneratingGemini] = useState<boolean>(false);
  const [geminiResultUrl, setGeminiResultUrl] = useState<string | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);

  // Module check & consent
  const [missingModules, setMissingModules] = useState<ModuleDefinition[]>([]);
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Keep offline fonts loaded
  useEffect(() => {
    if (isOpen) {
      loadModuleScript('fonts').catch(() => {});
    }
  }, [isOpen]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (renderedVideoUrl) URL.revokeObjectURL(renderedVideoUrl);
    };
  }, [renderedVideoUrl]);

  // Template change handler
  const handleTemplateChange = (templateId: string) => {
    const tpl = SAMPLE_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) {
      setSelectedTemplateId(templateId);
      setSceneJsonText(JSON.stringify(tpl, null, 2));
      setCurrentScene(tpl);
      setValidationErrors([]);
      setCurrentTime(0);
      setIsPlaying(false);
      setRenderedVideoUrl(null);
    }
  };

  // JSON editor change handler
  const handleJsonChange = (text: string) => {
    setSceneJsonText(text);
    try {
      const parsed = JSON.parse(text);
      const validation = validateScene(parsed);
      if (validation.valid && validation.scene) {
        setCurrentScene(validation.scene);
        setValidationErrors([]);
      } else {
        setValidationErrors(validation.errors);
      }
    } catch (e: any) {
      setValidationErrors([`JSON Syntax Error: ${e.message}`]);
    }
  };

  // Canvas drawing loop
  useEffect(() => {
    if (!canvasRef.current || !currentScene) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderScene(currentScene, currentTime, ctx);
  }, [currentScene, currentTime]);

  // Playback animation frame loop
  useEffect(() => {
    if (!isPlaying) {
      lastTimeRef.current = null;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const duration = currentScene.canvas.duration;

    const tick = (now: number) => {
      if (lastTimeRef.current !== null) {
        const deltaSec = ((now - lastTimeRef.current) / 1000) * playbackSpeed;
        setCurrentTime((prev) => {
          let next = prev + deltaSec;
          if (next >= duration) {
            if (isLooping) {
              next = next % duration;
            } else {
              setIsPlaying(false);
              return duration;
            }
          }
          return next;
        });
      }
      lastTimeRef.current = now;
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, playbackSpeed, isLooping, currentScene.canvas.duration]);

  // Format timecode MM:SS:FF
  const formatTimecode = (seconds: number, fps: number) => {
    const totalFrames = Math.floor(seconds * fps);
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const f = totalFrames % fps;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

  // Ensure modules installed before executing action
  const ensureModulesThen = async (requiredFor: 'video' | 'image' | 'both', action: () => void) => {
    try {
      const missing = await checkMissingModules(requiredFor);
      if (missing.length > 0) {
        setMissingModules(missing);
        setPendingAction(() => action);
        setShowConsentModal(true);
      } else {
        action();
      }
    } catch {
      action();
    }
  };

  // Render Video action
  const startVideoRender = async () => {
    setIsRendering(true);
    setRenderError(null);
    setRenderProgress(null);
    setIsPlaying(false);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const deviceCheck = await checkDeviceCapabilities();
      let videoBlob: Blob;

      if (deviceCheck.recommendedRenderPath === 'webcodecs-h264') {
        videoBlob = await renderVideoWebCodecs({
          scene: currentScene,
          onProgress: (p) => setRenderProgress(p),
          abortSignal: abortController.signal,
        });
      } else {
        videoBlob = await renderVideoMediaRecorder({
          scene: currentScene,
          onProgress: (p) => setRenderProgress(p),
          abortSignal: abortController.signal,
        });
      }

      const url = URL.createObjectURL(videoBlob);
      setRenderedVideoUrl(url);

      // Save to Dexie files table
      const fileRecord: StoredFile = {
        id: `video_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${currentScene.name || 'motion-scene'}.mp4`,
        type: videoBlob.type.includes('mp4') ? 'video/mp4' : 'video/webm',
        size: videoBlob.size,
        createdAt: Date.now(),
        blob: videoBlob,
        sceneJson: currentScene,
        duration: currentScene.canvas.duration,
        width: currentScene.canvas.width,
        height: currentScene.canvas.height,
      };
      await db.files.put(fileRecord);
    } catch (err: any) {
      if (err.message !== 'Rendering cancelled by user') {
        setRenderError(err.message || 'Render failed');
      }
    } finally {
      setIsRendering(false);
      abortControllerRef.current = null;
    }
  };

  const cancelVideoRender = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsRendering(false);
    setRenderProgress(null);
  };

  // Export Still PNG action
  const handleExportStill = async () => {
    try {
      let targetW = currentScene.canvas.width;
      let targetH = currentScene.canvas.height;

      if (exportAspectRatio === '1:1') {
        targetW = 1080;
        targetH = 1080;
      } else if (exportAspectRatio === '4:5') {
        targetW = 1080;
        targetH = 1350;
      } else if (exportAspectRatio === '9:16') {
        targetW = 1080;
        targetH = 1920;
      } else if (exportAspectRatio === '16:9') {
        targetW = 1920;
        targetH = 1080;
      }

      const blob = await renderStillPng({
        scene: currentScene,
        t: currentTime,
        targetWidth: targetW,
        targetHeight: targetH,
      });

      // Save to Dexie files table
      const fileRecord: StoredFile = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `still_${Math.round(currentTime * 100) / 100}s.png`,
        type: 'image/png',
        size: blob.size,
        createdAt: Date.now(),
        blob: blob,
        width: targetW,
        height: targetH,
      };
      await db.files.put(fileRecord);

      // Trigger user download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileRecord.name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    }
  };

  // Gemini Image Generation
  const handleGenerateGemini = async () => {
    if (!activeKeySecret) {
      setGeminiError('No active Gemini API key connected. Please add or select an active key in Settings.');
      return;
    }
    if (!geminiPrompt.trim()) {
      setGeminiError('Please enter a prompt describing the image you want to generate.');
      return;
    }

    setIsGeneratingGemini(true);
    setGeminiError(null);
    setGeminiResultUrl(null);

    try {
      const res = await fetch('/api/gemini/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': activeKeySecret,
        },
        body: JSON.stringify({
          prompt: geminiPrompt.trim(),
          model: geminiModel,
          aspectRatio: geminiAspectRatio,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Image generation failed');
      }

      setGeminiResultUrl(data.image);

      // Save to Dexie files table as data blob
      const resBlob = await (await fetch(data.image)).blob();
      const fileRecord: StoredFile = {
        id: `gemini_img_${Date.now()}`,
        name: `gemini_${geminiAspectRatio}.png`,
        type: 'image/png',
        size: resBlob.size,
        createdAt: Date.now(),
        blob: resBlob,
        prompt: geminiPrompt,
      };
      await db.files.put(fileRecord);
    } catch (e: any) {
      setGeminiError(e.message || 'Image generation failed');
    } finally {
      setIsGeneratingGemini(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-[#0F1115] border border-neutral-800 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/80 bg-neutral-900/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#FF5B3A]/10 text-[#FF5B3A]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Motion Studio
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#FF5B3A]/20 text-[#FF7A5C] border border-[#FF5B3A]/30">
                  Lab v2.0
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Deterministic Client-Side Animation & Graphic Synthesis
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode Switcher */}
            <div className="flex items-center p-1 rounded-xl bg-neutral-900 border border-neutral-800">
              <button
                onClick={() => setActiveTab('video')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'video'
                    ? 'bg-[#FF5B3A] text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                Video Lab
              </button>
              <button
                onClick={() => setActiveTab('image')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'image'
                    ? 'bg-[#FF5B3A] text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Image Lab
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {activeTab === 'video' ? (
            <div className="space-y-6">
              {/* Template selector row */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-neutral-900/60 border border-neutral-800">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
                  <span className="text-xs text-neutral-400 font-medium pl-1">Templates:</span>
                  {SAMPLE_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => handleTemplateChange(tpl.id!)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                        selectedTemplateId === tpl.id
                          ? 'bg-neutral-800 text-white border border-[#FF5B3A]/40'
                          : 'text-neutral-400 hover:text-white bg-neutral-950/40 hover:bg-neutral-800/40'
                      }`}
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTemplateChange(selectedTemplateId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-750 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>
              </div>

              {/* Main Grid: Canvas Preview + Controls (Left) & JSON Schema Editor (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Canvas Player & Timeline */}
                <div className="lg:col-span-7 flex flex-col space-y-4">
                  {/* Canvas Viewport */}
                  <div className="relative aspect-video w-full rounded-2xl bg-black border border-neutral-800 overflow-hidden flex items-center justify-center shadow-inner">
                    <canvas
                      ref={canvasRef}
                      width={currentScene.canvas.width}
                      height={currentScene.canvas.height}
                      className="w-full h-full object-contain"
                    />

                    {/* Rendering Overlay */}
                    {isRendering && (
                      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-4 animate-fade-in">
                        <Loader2 className="w-10 h-10 animate-spin text-[#FF5B3A]" />
                        <div className="space-y-1">
                          <h4 className="text-base font-semibold text-white">Synthesizing MP4 Video</h4>
                          <p className="text-xs text-neutral-400">
                            Encoding frame-by-frame with WebCodecs hardware accelerator...
                          </p>
                        </div>

                        {renderProgress && (
                          <div className="w-full max-w-sm space-y-2">
                            <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-[#FF5B3A] h-full rounded-full transition-all duration-150"
                                style={{ width: `${renderProgress.percent}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
                              <span>
                                Frame {renderProgress.frame} / {renderProgress.totalFrames} ({renderProgress.percent}%)
                              </span>
                              <span>{renderProgress.fps} FPS</span>
                            </div>
                            <div className="text-[10px] text-neutral-500">
                              Estimated remaining: {(renderProgress.estimatedRemainingMs / 1000).toFixed(1)}s
                            </div>
                          </div>
                        )}

                        <button
                          onClick={cancelVideoRender}
                          className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 transition-colors"
                        >
                          Cancel Synthesis
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Player Controls & Scrubber */}
                  <div className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 space-y-3">
                    {/* Scrub Slider */}
                    <div className="space-y-1">
                      <input
                        type="range"
                        min={0}
                        max={currentScene.canvas.duration}
                        step={0.01}
                        value={currentTime}
                        onChange={(e) => {
                          setCurrentTime(parseFloat(e.target.value));
                          setIsPlaying(false);
                        }}
                        className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-[#FF5B3A]"
                      />
                      <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                        <span>{formatTimecode(currentTime, currentScene.canvas.fps)}</span>
                        <span>{formatTimecode(currentScene.canvas.duration, currentScene.canvas.fps)}</span>
                      </div>
                    </div>

                    {/* Button Controls Row */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setIsPlaying(!isPlaying)}
                          className="p-2.5 rounded-xl bg-[#FF5B3A] hover:bg-[#E04B2C] text-white transition-colors"
                          title={isPlaying ? 'Pause' : 'Play'}
                        >
                          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => {
                            setCurrentTime(0);
                            setIsPlaying(false);
                          }}
                          className="p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                          title="Rewind to Start"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => setIsLooping(!isLooping)}
                          className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                            isLooping
                              ? 'bg-neutral-800 border-[#FF5B3A]/40 text-[#FF7A5C]'
                              : 'bg-neutral-900 border-neutral-800 text-neutral-500'
                          }`}
                        >
                          Loop
                        </button>

                        {/* Speed Selector */}
                        <div className="flex items-center rounded-xl bg-neutral-950 p-0.5 border border-neutral-800 text-xs">
                          {[0.5, 1, 2].map((spd) => (
                            <button
                              key={spd}
                              onClick={() => setPlaybackSpeed(spd)}
                              className={`px-2 py-1 rounded-lg font-mono transition-colors ${
                                playbackSpeed === spd
                                  ? 'bg-neutral-800 text-white'
                                  : 'text-neutral-500 hover:text-neutral-300'
                              }`}
                            >
                              {spd}x
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Export / Render Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => ensureModulesThen('image', handleExportStill)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-750 transition-colors"
                          title="Export Current Frame as PNG"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          Still PNG
                        </button>

                        <button
                          onClick={() => ensureModulesThen('video', startVideoRender)}
                          disabled={isRendering || validationErrors.length > 0}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#FF5B3A] hover:bg-[#E04B2C] shadow-lg shadow-[#FF5B3A]/20 transition-all disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Render MP4
                        </button>
                      </div>
                    </div>
                  </div>

                  {renderError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{renderError}</span>
                    </div>
                  )}

                  {/* Rendered Video Result Preview */}
                  {renderedVideoUrl && (
                    <div className="p-4 rounded-2xl bg-neutral-900/60 border border-emerald-500/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          Video Render Complete!
                        </div>
                        <a
                          href={renderedVideoUrl}
                          download={`${currentScene.name || 'motion-video'}.mp4`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-neutral-950 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download MP4
                        </a>
                      </div>
                      <video
                        src={renderedVideoUrl}
                        controls
                        autoPlay
                        className="w-full rounded-xl bg-black border border-neutral-800 aspect-video object-contain"
                      />
                    </div>
                  )}
                </div>

                {/* Right: Interactive JSON Schema Editor */}
                <div className="lg:col-span-5 flex flex-col space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-300 flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-[#FF5B3A]" />
                      Scene JSON Schema
                    </span>
                    {validationErrors.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                        <Check className="w-3 h-3" /> Valid Schema
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-400">
                        <AlertTriangle className="w-3 h-3" /> Invalid Schema
                      </span>
                    )}
                  </div>

                  {/* Schema Validation Error List */}
                  {validationErrors.length > 0 && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 space-y-1 max-h-32 overflow-y-auto font-mono">
                      {validationErrors.map((err, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span>•</span>
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Code Editor */}
                  <div className="relative flex-1 min-h-[380px] rounded-2xl bg-neutral-950 border border-neutral-800 overflow-hidden flex flex-col">
                    <div className="px-4 py-2 bg-neutral-900/60 border-b border-neutral-800 text-[10px] font-mono text-neutral-500 flex justify-between items-center">
                      <span>scene.json (live reactive)</span>
                      <span>{currentScene.tracks.length} Tracks • {currentScene.canvas.fps} FPS</span>
                    </div>
                    <textarea
                      value={sceneJsonText}
                      onChange={(e) => handleJsonChange(e.target.value)}
                      spellCheck={false}
                      className="flex-1 w-full p-4 bg-transparent text-neutral-200 font-mono text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-[#FF5B3A]/40"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* IMAGE LAB TAB */
            <div className="space-y-6">
              {/* Image Lab Sub-Tabs */}
              <div className="flex items-center gap-2 border-b border-neutral-800 pb-3">
                <button
                  onClick={() => setImageTab('export')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                    imageTab === 'export'
                      ? 'bg-neutral-800 text-white border border-[#FF5B3A]/30'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Path 1: Scene Frame Exporter (PNG)
                </button>
                <button
                  onClick={() => setImageTab('gemini')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                    imageTab === 'gemini'
                      ? 'bg-neutral-800 text-white border border-[#FF5B3A]/30'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Path 2: Gemini AI Image Generator
                </button>
              </div>

              {imageTab === 'export' ? (
                /* Path 1: Scene Frame Export */
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-7 space-y-4">
                    <div className="aspect-video w-full rounded-2xl bg-black border border-neutral-800 overflow-hidden flex items-center justify-center">
                      <canvas
                        ref={canvasRef}
                        width={currentScene.canvas.width}
                        height={currentScene.canvas.height}
                        className="w-full h-full object-contain"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={currentScene.canvas.duration}
                        step={0.01}
                        value={currentTime}
                        onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                        className="flex-1 h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-[#FF5B3A]"
                      />
                      <span className="text-xs font-mono text-neutral-400">
                        {currentTime.toFixed(2)}s
                      </span>
                    </div>
                  </div>

                  <div className="md:col-span-5 p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800 space-y-5">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold text-white">Target Aspect Ratio</h4>
                      <p className="text-xs text-neutral-400">
                        Export current animated frame at pristine high resolution.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        { ratio: '1:1', label: '1:1 Square (1080x1080)' },
                        { ratio: '4:5', label: '4:5 Portrait (1080x1350)' },
                        { ratio: '9:16', label: '9:16 Story/Reel (1080x1920)' },
                        { ratio: '16:9', label: '16:9 Landscape (1920x1080)' },
                      ].map((item) => (
                        <button
                          key={item.ratio}
                          onClick={() => setExportAspectRatio(item.ratio as any)}
                          className={`p-3 rounded-xl text-left border transition-all ${
                            exportAspectRatio === item.ratio
                              ? 'bg-neutral-800 border-[#FF5B3A] text-white'
                              : 'bg-neutral-950/40 border-neutral-800 text-neutral-400 hover:text-white'
                          }`}
                        >
                          <div className="text-xs font-bold">{item.ratio}</div>
                          <div className="text-[10px] text-neutral-500 mt-0.5">{item.label}</div>
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => ensureModulesThen('image', handleExportStill)}
                      className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-semibold text-white bg-[#FF5B3A] hover:bg-[#E04B2C] shadow-lg shadow-[#FF5B3A]/20 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      Export Pristine PNG ({exportAspectRatio})
                    </button>
                  </div>
                </div>
              ) : (
                /* Path 2: Gemini Image Generation */
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-6 space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-neutral-300">
                        Image Generation Prompt
                      </label>
                      <textarea
                        value={geminiPrompt}
                        onChange={(e) => setGeminiPrompt(e.target.value)}
                        placeholder="e.g. Modern geometric logo reveal emblem with neon vermilion highlights on dark slate background, ultra high definition 3d render..."
                        rows={4}
                        className="w-full p-3 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-[#FF5B3A]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-neutral-300">Aspect Ratio</label>
                      <div className="grid grid-cols-5 gap-2">
                        {['1:1', '3:4', '4:3', '9:16', '16:9'].map((r) => (
                          <button
                            key={r}
                            onClick={() => setGeminiAspectRatio(r as any)}
                            className={`py-2 text-xs font-mono font-medium rounded-xl border transition-all ${
                              geminiAspectRatio === r
                                ? 'bg-neutral-800 border-[#FF5B3A] text-white'
                                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-neutral-300">Model</label>
                      <input
                        type="text"
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-xs font-mono text-neutral-300 focus:outline-none focus:ring-1 focus:ring-[#FF5B3A]"
                      />
                    </div>

                    {geminiError && (
                      <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <p>{geminiError}</p>
                          <p className="text-[11px] text-neutral-400 mt-1">
                            Note: If your key has no Imagen quota, use Path 1 above to export high-res scene still frames for free!
                          </p>
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleGenerateGemini}
                      disabled={isGeneratingGemini || !geminiPrompt.trim()}
                      className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-semibold text-white bg-[#FF5B3A] hover:bg-[#E04B2C] shadow-lg shadow-[#FF5B3A]/20 transition-all disabled:opacity-50"
                    >
                      {isGeneratingGemini ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating Image via Gemini...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Generate Image with User Key
                        </>
                      )}
                    </button>
                  </div>

                  <div className="md:col-span-6 flex flex-col items-center justify-center p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 min-h-[340px]">
                    {geminiResultUrl ? (
                      <div className="space-y-3 w-full flex flex-col items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={geminiResultUrl}
                          alt="Gemini Generated"
                          className="max-h-[380px] w-auto rounded-xl object-contain border border-neutral-800 shadow-xl"
                        />
                        <a
                          href={geminiResultUrl}
                          download={`gemini-${geminiAspectRatio}.png`}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-neutral-950 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download Generated PNG
                        </a>
                      </div>
                    ) : (
                      <div className="text-center space-y-2 text-neutral-500">
                        <ImageIcon className="w-12 h-12 mx-auto stroke-1" />
                        <p className="text-xs">Generated image preview will appear here</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Consent Modal for Missing Modules */}
      <ConsentModal
        isOpen={showConsentModal}
        missingModules={missingModules}
        onClose={() => setShowConsentModal(false)}
        onSuccess={() => {
          setShowConsentModal(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }}
      />
    </div>
  );
}
