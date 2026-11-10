'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Mic, MicOff, Volume2, AlertCircle, Loader2 } from 'lucide-react';
import { decryptKeyText } from '../lib/crypto';
import type { StoredKey } from '../lib/types';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTranscriptReceived: (userText: string, aiText: string, modelName: string) => void;
  keys: StoredKey[];
}

function findLiveCapableSetup(keys: StoredKey[]): { key: StoredKey; model: any } | null {
  const validKeys = keys.filter((k) => k.state !== 'invalid');
  for (const key of validKeys) {
    if (Array.isArray(key.models)) {
      const found = key.models.find(
        (m) =>
          m.category === 'live' ||
          m.category === 'audio' ||
          m.id.toLowerCase().includes('live') ||
          m.id.toLowerCase().includes('realtime')
      );
      if (found) {
        return { key, model: found };
      }
    }
  }

  // Fallback to any model containing 'live'
  for (const key of validKeys) {
    if (Array.isArray(key.models)) {
      const liveFallback = key.models.find((m) => m.id.includes('live'));
      if (liveFallback) return { key, model: liveFallback };
    }
  }

  return null;
}

export function LiveVoiceModal({
  isOpen,
  onClose,
  onTranscriptReceived,
  keys,
}: LiveVoiceModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<string>('Ready to start Live audio turn');
  const [interimText, setInterimText] = useState<string>('');
  const [aiReply, setAiReply] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  const liveSetup = findLiveCapableSetup(keys);

  const handleClose = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    setIsRecording(false);
    setInterimText('');
    setAiReply('');
    setErrorMsg(null);
    setStatus('Ready to start Live audio turn');
    onClose();
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  if (!isOpen) return null;

  const startRecording = async () => {
    if (!liveSetup) {
      setErrorMsg('No live voice models found on your configured keys. Gemini Live requires an API key with access to Live audio models.');
      return;
    }

    setErrorMsg(null);
    setAiReply('');
    setInterimText('');
    setStatus(`Listening via ${liveSetup.model.displayName}...`);

    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let current = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            current += event.results[i][0].transcript;
          }
          setInterimText(current);
        };

        recognition.onerror = () => {};
        recognition.start();
        recognitionRef.current = recognition;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Microphone access denied or unsupported.');
      setStatus('Microphone unavailable');
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }

    setIsRecording(false);
  };

  const handleSendLiveTurn = async () => {
    stopRecording();
    const promptToSend = interimText.trim();

    if (!promptToSend && audioChunksRef.current.length === 0) {
      setErrorMsg('No speech detected. Please speak into your microphone and try again.');
      return;
    }

    if (!liveSetup) {
      setErrorMsg('No live voice models found on your configured keys.');
      return;
    }

    setIsProcessing(true);
    setStatus(`Processing with ${liveSetup.model.displayName}...`);

    try {
      const plainKey = await decryptKeyText(liveSetup.key.encryptedKey, liveSetup.key.iv);

      let base64Audio = '';
      if (audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        base64Audio = await new Promise((resolve) => {
          reader.onloadend = () => {
            const res = reader.result as string;
            const commaIdx = res.indexOf(',');
            resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
          };
          reader.readAsDataURL(audioBlob);
        });
      }

      const res = await fetch('/api/gemini/live', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': plainKey,
        },
        body: JSON.stringify({
          prompt: promptToSend || 'Hello, I am speaking via Gemini Live API.',
          audioData: base64Audio || undefined,
          model: liveSetup.model.id,
          mimeType: 'audio/webm',
        }),
      });

      if (!res.ok) {
        let errJson: any = {};
        try { errJson = await res.json(); } catch { /* ignore */ }
        throw new Error(errJson?.error || `Server returned status ${res.status}`);
      }

      const data = await res.json();
      const reply = data.text || 'Live interaction complete.';
      setAiReply(reply);
      setStatus('Live response received');

      onTranscriptReceived(
        promptToSend || '[Voice Audio Input]',
        reply,
        liveSetup.model.displayName
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Live API request failed.');
      setStatus('Error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="live-voice-title">
      <div className="modal-card max-w-lg">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="ai-dot-breathe" />
            <h3 id="live-voice-title" className="font-semibold text-sm">
              Gemini Live Voice Mode
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="btn-icon"
            aria-label="Close Live mode"
          >
            <X size={16} />
          </button>
        </div>

        <div className="py-6 flex flex-col items-center justify-center text-center gap-4">
          {!liveSetup ? (
            <div className="p-4 bg-[var(--bg-surface-hover)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-muted)] space-y-2 max-w-sm">
              <AlertCircle size={24} className="mx-auto text-[var(--color-vermilion)]" />
              <p className="font-medium text-[var(--text-main)]">No Live Voice Model Found</p>
              <p>
                None of your configured API keys currently support real-time Live/Audio models.
                Live audio interaction requires an API key with access to Gemini Live models.
              </p>
            </div>
          ) : (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                    isRecording
                      ? 'bg-[var(--color-vermilion)] text-white shadow-lg ring-8 ring-[var(--color-vermilion-subtle)]'
                      : 'bg-[var(--bg-surface-hover)] border border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--border-focus)]'
                  }`}
                  aria-label={isRecording ? 'Stop listening' : 'Start listening'}
                >
                  {isRecording ? <Mic size={32} /> : <MicOff size={30} className="text-muted" />}
                </button>
              </div>

              <div>
                <p className="text-xs font-mono text-[var(--text-muted)]">{status}</p>
                {liveSetup && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Model: {liveSetup.model.displayName} ({liveSetup.key.label})
                  </p>
                )}
                {isRecording && (
                  <p className="text-xs text-[var(--color-vermilion)] mt-1 animate-pulse">
                    Recording live audio... Click microphone to pause, or Send below.
                  </p>
                )}
              </div>

              {interimText && (
                <div className="w-full card-panel text-left text-xs text-[var(--text-main)] max-h-24 overflow-y-auto">
                  <span className="font-semibold text-muted block mb-1">Recognized speech:</span>
                  <p>{interimText}</p>
                </div>
              )}

              {aiReply && (
                <div className="w-full card-panel text-left text-xs bg-[var(--bg-surface-hover)] max-h-32 overflow-y-auto">
                  <span className="font-semibold text-success flex items-center gap-1 mb-1">
                    <Volume2 size={13} />
                    <span>Response from {liveSetup.model.displayName}:</span>
                  </span>
                  <p>{aiReply}</p>
                </div>
              )}

              {errorMsg && (
                <div className="feedback-box feedback-error w-full text-left" role="alert">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-[var(--border-color)]">
          <button
            type="button"
            onClick={handleClose}
            className="btn-secondary btn-sm"
          >
            Cancel
          </button>

          {liveSetup && (
            <div className="flex gap-2">
              {isRecording ? (
                <button
                  type="button"
                  onClick={handleSendLiveTurn}
                  className="btn-primary btn-sm"
                >
                  <span>Send Turn</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={isProcessing}
                  className="btn-primary btn-sm"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={13} className="spinner" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Mic size={13} />
                      <span>Start Speaking</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
