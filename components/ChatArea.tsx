'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Square,
  Paperclip,
  ArrowDown,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  AlertCircle,
  WifiOff,
  Mic,
} from 'lucide-react';
import { MarkdownView } from './MarkdownView';
import type { ChatMessage } from '../lib/types';

interface ChatAreaProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessage: string;
  streamingStatusText: string;
  streamingKeyLabel?: string;
  streamingModelDisplayName?: string;
  error: string | null;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onRetryLast: (messageId?: string) => void;
  onDeleteMessage: (messageId: string) => void;
  isOnline: boolean;
  onOpenLiveVoice?: () => void;
}

const SUGGESTION_CHIPS = [
  {
    label: 'Explain quantum computing in simple terms',
    tag: 'Concept',
  },
  {
    label: 'একটি বাংলা ছোটগল্প লিখুন যা বৃষ্টির দিনে শুরু হয়',
    tag: 'বাংলা সাহিত্য',
  },
  {
    label: 'Draft a clean TypeScript function for debouncing with cancellation',
    tag: 'Code',
  },
];

export function ChatArea({
  messages,
  isStreaming,
  streamingMessage,
  streamingStatusText,
  streamingKeyLabel,
  streamingModelDisplayName,
  error,
  onSendMessage,
  onStopStreaming,
  onRetryLast,
  onDeleteMessage,
  isOnline,
  onOpenLiveVoice,
}: ChatAreaProps) {
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef(false);

  // Auto-grow textarea up to 6 lines (~140px)
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(el.scrollHeight, 140);
    el.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputText, adjustTextareaHeight]);

  // Handle scroll detection
  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 70;
    userScrolledUpRef.current = !isNearBottom;
    setShowScrollBottom(!isNearBottom);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
  };

  // Auto-scroll on new message chunks if user hasn't deliberately scrolled up
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom('auto');
    }
  }, [messages, streamingMessage, isStreaming]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || isStreaming) return;

    onSendMessage(text);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleSuggestionClick = (prompt: string) => {
    setInputText(prompt);
    textareaRef.current?.focus();
    setTimeout(adjustTextareaHeight, 10);
  };

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="chat-layout-wrapper">
      {/* Offline banner if disconnected */}
      {!isOnline && (
        <div className="offline-banner" role="status">
          <WifiOff size={15} />
          <span>You are currently offline. Gemini API calls require internet connectivity.</span>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="chat-scroll-container"
      >
        {isEmpty ? (
          <div className="empty-chat-welcome">
            <div className="welcome-inner">
              <h2 className="welcome-headline">
                Thought in motion.
                <span className="welcome-bengali-sub">চিন্তা ও সৃষ্টির মুক্ত প্রবাহ</span>
              </h2>

              <p className="welcome-body">
                Bring your own key, explore ideas without intermediaries, and compose with natural language in English and Bengali.
              </p>

              <div className="suggestion-chips-grid">
                {SUGGESTION_CHIPS.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSuggestionClick(chip.label)}
                    className="suggestion-chip-btn"
                  >
                    <span className="chip-tag">{chip.tag}</span>
                    <span className="chip-label">{chip.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="messages-flow-container">
            {messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              const isLastAi = !isUser && index === messages.length - 1;

              return (
                <div
                  key={msg.id}
                  className={`message-row ${isUser ? 'user-message-row' : 'ai-message-row'}`}
                >
                  {isUser ? (
                    <div className="user-bubble">
                      <div className="user-text-body">{msg.content}</div>
                      <div className="message-meta-bar user-meta">
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="msg-action-btn"
                          aria-label="Copy message"
                          title="Copy"
                        >
                          {copiedId === msg.id ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteMessage(msg.id)}
                          className="msg-action-btn hover-danger"
                          aria-label="Delete message"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ai-text-block">
                      <div className="ai-content-body">
                        <MarkdownView content={msg.content} />
                      </div>

                      {/* Display which key and which model answered: "via Key 2 · Gemini 2.5 Flash" */}
                      <div className="message-meta-bar ai-meta flex items-center justify-between">
                        <div>
                          {(msg.keyLabel || msg.modelDisplayName || msg.modelName) && (
                            <span className="key-answered-tag text-[11px] text-[var(--text-muted)] font-mono">
                              via {msg.keyLabel || 'Key'}
                              {(msg.modelDisplayName || msg.modelName) && (
                                <> &middot; {msg.modelDisplayName || msg.modelName}</>
                              )}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="msg-action-btn"
                            aria-label="Copy AI response"
                            title="Copy response"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check size={12} className="text-success" />
                                <span className="action-label">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy size={12} />
                                <span className="action-label">Copy</span>
                              </>
                            )}
                          </button>

                          {isLastAi && !isStreaming && (
                            <button
                              type="button"
                              onClick={() => onRetryLast(msg.id)}
                              className="msg-action-btn"
                              aria-label="Retry response"
                              title="Retry"
                            >
                              <RotateCcw size={12} />
                              <span className="action-label">Retry</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onDeleteMessage(msg.id)}
                            className="msg-action-btn hover-danger"
                            aria-label="Delete response"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Currently streaming message */}
            {isStreaming && (
              <div className="message-row ai-message-row">
                <div className="ai-text-block">
                  {streamingMessage ? (
                    <div className="ai-content-body">
                      <MarkdownView content={streamingMessage} />
                    </div>
                  ) : null}

                  <div className="ai-working-indicator" role="status">
                    <span className="ai-dot-breathe" />
                    <span className="ai-working-text">
                      {streamingStatusText || 'Generating thought in stream...'}
                    </span>
                    {streamingKeyLabel && (
                      <span className="streaming-key-tag">
                        via {streamingKeyLabel}
                        {streamingModelDisplayName ? ` · ${streamingModelDisplayName}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && !isStreaming && (
              <div className="chat-error-card" role="alert">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="text-error shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-error mb-1">Response Generation Failed</p>
                    <p className="text-xs text-muted mb-3">{error}</p>
                    <button
                      type="button"
                      onClick={() => onRetryLast()}
                      className="btn-secondary btn-sm"
                    >
                      <RotateCcw size={13} />
                      <span>Retry Request</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {showScrollBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="jump-to-latest-btn"
          aria-label="Scroll to latest messages"
        >
          <ArrowDown size={14} />
          <span>Latest</span>
        </button>
      )}

      {/* Bottom Input Bar */}
      <footer className="chat-input-bar">
        <form onSubmit={handleSubmit} className="input-form-container">
          <button
            type="button"
            disabled
            className="input-attach-btn"
            title="Coming in a later push"
            aria-label="File upload (Coming in a later push)"
          >
            <Paperclip size={18} />
            <span className="sr-only">Attach file (Coming in a later push)</span>
          </button>

          {onOpenLiveVoice && (
            <button
              type="button"
              onClick={onOpenLiveVoice}
              className="input-live-btn"
              title="Gemini Live Voice Mode"
              aria-label="Start Gemini Live Voice Mode"
            >
              <Mic size={18} />
            </button>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message in English or বাংলা..."
            className="chat-textarea"
            aria-label="Message prompt input"
            spellCheck="true"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onStopStreaming}
              className="btn-stop-streaming"
              aria-label="Stop generation"
              title="Stop stream"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="btn-send-message"
              aria-label="Send message"
              title="Send (Enter)"
            >
              <Send size={16} />
            </button>
          )}
        </form>

        {/* Honest, neutral footer */}
        <div className="input-bar-subtext">
          <span>Motion Studio</span>
        </div>
      </footer>
    </div>
  );
}
