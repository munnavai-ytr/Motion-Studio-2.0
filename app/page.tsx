'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../lib/db';
import { isPassphraseProtected, getActiveCryptoKey } from '../lib/crypto';
import {
  streamGeminiChat,
  runStartupMigration,
  checkAllKeysHealth,
  getFirstDecryptedKeySecret,
  AUTO_MODEL_ID,
} from '../lib/gemini';
import { appEvents } from '../lib/events';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { ChatArea } from '../components/ChatArea';
import { SettingsModal } from '../components/SettingsModal';
import { OnboardingModal } from '../components/OnboardingModal';
import { PassphraseModal } from '../components/PassphraseModal';
import { LiveVoiceModal } from '../components/LiveVoiceModal';
import { ModelPicker } from '../components/ModelPicker';
import { StudioModal } from '../components/StudioModal';
import { PrepareStudioCard } from '../components/PrepareStudioCard';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { Conversation, ChatMessage, StoredKey } from '../lib/types';

export default function HomePage() {
  return (
    <ErrorBoundary>
      <MotionStudioApp />
    </ErrorBoundary>
  );
}

function MotionStudioApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [keys, setKeys] = useState<StoredKey[]>([]);

  // Modals & UI states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isPassphraseRequired, setIsPassphraseRequired] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [activeKeySecret, setActiveKeySecret] = useState<string | undefined>(undefined);

  const handleOpenStudio = async () => {
    try {
      const secret = await getFirstDecryptedKeySecret();
      setActiveKeySecret(secret);
    } catch {
      // ignore
    }
    setIsStudioOpen(true);
  };

  // App settings
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [selectedModel, setSelectedModel] = useState<string>(AUTO_MODEL_ID);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Chat Streaming states
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingStatus, setStreamingStatus] = useState('');
  const [streamingKeyLabel, setStreamingKeyLabel] = useState<string | undefined>(undefined);
  const [streamingModelDisplayName, setStreamingModelDisplayName] = useState<string | undefined>(undefined);
  const [chatError, setChatError] = useState<string | null>(null);

  // Ref to fix stale closure on aborted streams
  const streamingTextRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Apply theme to document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Network online/offline detection
  useEffect(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const timer = setTimeout(() => setIsOnline(false), 0);
      return () => clearTimeout(timer);
    }
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Reload keys from Dexie
  const refreshKeys = useCallback(async () => {
    const allKeys = await db.keys.toArray();
    setKeys(allKeys);
    if (allKeys.length === 0) {
      setIsOnboardingOpen(true);
    }
  }, []);

  // Listen for reactive key updates via appEvents
  useEffect(() => {
    const unsubscribe = appEvents.on('keys:changed', () => {
      refreshKeys();
    });
    return unsubscribe;
  }, [refreshKeys]);

  // Initial Boot sequence
  useEffect(() => {
    async function boot() {
      // 1. Run startup migration to heal legacy 'error' and 'rate-limited' keys
      await runStartupMigration();

      // 2. Check Theme setting
      const themeSetting = await db.settings.get('theme');
      if (themeSetting?.value) {
        setTheme(themeSetting.value);
      }

      // 3. Check Model setting (default is AUTO_MODEL_ID)
      const modelSetting = await db.settings.get('selected_model');
      if (modelSetting?.value) {
        setSelectedModel(modelSetting.value);
      } else {
        setSelectedModel(AUTO_MODEL_ID);
      }

      // 4. Check Passphrase protection
      const isProtected = await isPassphraseProtected();
      if (isProtected) {
        const activeKey = await getActiveCryptoKey();
        if (!activeKey) {
          setIsPassphraseRequired(true);
          return;
        }
      }

      // 5. Load keys and run background health checks
      const allKeys = await db.keys.toArray();
      setKeys(allKeys);

      if (allKeys.length === 0) {
        setIsOnboardingOpen(true);
      } else {
        // Automatic background health check on app start
        checkAllKeysHealth().catch(() => {});
      }

      // 6. Load conversations
      const allConversations = await db.conversations.orderBy('updatedAt').reverse().toArray();
      setConversations(allConversations);

      if (allConversations.length > 0) {
        setActiveConversationId(allConversations[0].id);
      }
    }

    boot();
  }, []);

  // Automatic background checks when tab becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAllKeysHealth().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Load messages when active conversation changes
  useEffect(() => {
    let isCancelled = false;

    if (!activeConversationId) {
      Promise.resolve().then(() => {
        if (!isCancelled) {
          setMessages([]);
        }
      });
      return () => {
        isCancelled = true;
      };
    }

    async function loadMessages() {
      if (!activeConversationId) return;
      const msgs = await db.messages
        .where('conversationId')
        .equals(activeConversationId)
        .sortBy('createdAt');
      if (!isCancelled) {
        setMessages(msgs);
        setChatError(null);
      }
    }

    loadMessages();

    return () => {
      isCancelled = true;
    };
  }, [activeConversationId]);

  // Create or select conversation
  const handleNewConversation = async () => {
    setActiveConversationId(null);
    setMessages([]);
    setChatError(null);
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    setChatError(null);
  };

  const handleRenameConversation = async (id: string, newTitle: string) => {
    await db.conversations.update(id, { title: newTitle, updatedAt: Date.now() });
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle, updatedAt: Date.now() } : c))
    );
  };

  const handleDeleteConversation = async (id: string) => {
    await db.conversations.delete(id);
    await db.messages.where('conversationId').equals(id).delete();

    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);

    if (activeConversationId === id) {
      if (remaining.length > 0) {
        setActiveConversationId(remaining[0].id);
      } else {
        setActiveConversationId(null);
        setMessages([]);
      }
    }
  };

  // Auto-title helper (local only, no extra AI call)
  const generateAutoTitle = (text: string): string => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 36) return cleaned;
    const truncated = cleaned.slice(0, 36);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…';
  };

  // Send message and stream Gemini response
  const handleSendMessage = async (userPrompt: string) => {
    setChatError(null);

    // Refuse to send if no keys configured
    const currentKeys = await db.keys.toArray();
    if (currentKeys.length === 0) {
      setChatError('No API keys configured. Please add your Gemini API key in Settings.');
      setIsOnboardingOpen(true);
      return;
    }

    let targetConvId = activeConversationId;

    // Create conversation if first message
    if (!targetConvId) {
      const newConvId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const title = generateAutoTitle(userPrompt);
      const newConv: Conversation = {
        id: newConvId,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.conversations.add(newConv);
      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(newConvId);
      targetConvId = newConvId;
    } else {
      await db.conversations.update(targetConvId, { updatedAt: Date.now() });
      setConversations((prev) =>
        prev.map((c) => (c.id === targetConvId ? { ...c, updatedAt: Date.now() } : c))
      );
    }

    // Save user message to Dexie
    const userMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const userMsg: ChatMessage = {
      id: userMsgId,
      conversationId: targetConvId,
      role: 'user',
      content: userPrompt,
      createdAt: Date.now(),
    };
    await db.messages.add(userMsg);
    setMessages((prev) => [...prev, userMsg]);

    // Setup streaming state with ref to fix stale closure
    setIsStreaming(true);
    setStreamingText('');
    streamingTextRef.current = '';
    setStreamingStatus('Initiating stream with Gemini...');
    setStreamingKeyLabel(undefined);
    setStreamingModelDisplayName(undefined);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const historyForApi = messages; // preceding messages
      const result = await streamGeminiChat(
        historyForApi,
        userPrompt,
        selectedModel,
        {
          onChunk: (chunkText) => {
            streamingTextRef.current += chunkText;
            setStreamingText(streamingTextRef.current);
            setStreamingStatus('Streaming response...');
          },
          onKeyUsed: (keyLabel, modelName, modelDisplayName) => {
            setStreamingKeyLabel(keyLabel);
            setStreamingModelDisplayName(modelDisplayName || modelName);
          },
          onKeySwitched: (fromLabel, toLabel, reason) => {
            setStreamingStatus(`Switching from ${fromLabel} to ${toLabel} (${reason})...`);
          },
          onStatusChange: (status) => {
            setStreamingStatus(status);
          },
        },
        abortController.signal
      );

      // Save completed AI message to Dexie with model metadata
      const aiMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        conversationId: targetConvId,
        role: 'model',
        content: result.fullText,
        createdAt: Date.now(),
        keyLabel: result.keyUsedLabel,
        modelName: result.modelName,
        modelDisplayName: result.modelDisplayName,
      };

      await db.messages.add(aiMsg);
      setMessages((prev) => [...prev, aiMsg]);
      await refreshKeys();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Access streamingTextRef.current instead of stale state closure!
        const generatedSoFar = streamingTextRef.current;
        if (generatedSoFar.trim()) {
          const aiMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          const aiMsg: ChatMessage = {
            id: aiMsgId,
            conversationId: targetConvId,
            role: 'model',
            content: generatedSoFar + ' [stopped by user]',
            createdAt: Date.now(),
            keyLabel: streamingKeyLabel,
            modelDisplayName: streamingModelDisplayName,
          };
          await db.messages.add(aiMsg);
          setMessages((prev) => [...prev, aiMsg]);
        }
      } else {
        setChatError(err?.message || 'Failed to complete response from Gemini API.');
      }
      await refreshKeys();
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      streamingTextRef.current = '';
      setStreamingStatus('');
      setStreamingKeyLabel(undefined);
      setStreamingModelDisplayName(undefined);
      abortControllerRef.current = null;
    }
  };

  // Abort current generation
  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Retry last response
  const handleRetryLast = async (messageId?: string) => {
    if (isStreaming) return;

    let history = [...messages];
    let promptToRetry = '';

    if (messageId) {
      const idx = history.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        if (history[idx].role === 'model') {
          const precedingUser = history.slice(0, idx).reverse().find((m) => m.role === 'user');
          if (precedingUser) {
            promptToRetry = precedingUser.content;
            await db.messages.delete(messageId);
            history = history.filter((m) => m.id !== messageId);
            setMessages(history);
          }
        }
      }
    } else {
      const lastUser = [...history].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        promptToRetry = lastUser.content;
      }
    }

    if (promptToRetry) {
      await handleSendMessage(promptToRetry);
    }
  };

  // Delete message
  const handleDeleteMessage = async (messageId: string) => {
    await db.messages.delete(messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  const handleLiveTranscriptReceived = async (userVoiceText: string, aiVoiceText: string, modelName: string) => {
    let targetConvId = activeConversationId;
    if (!targetConvId) {
      const newConvId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const title = generateAutoTitle(userVoiceText);
      const newConv: Conversation = {
        id: newConvId,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.conversations.add(newConv);
      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(newConvId);
      targetConvId = newConvId;
    } else {
      await db.conversations.update(targetConvId, { updatedAt: Date.now() });
    }

    const userMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const userMsg: ChatMessage = {
      id: userMsgId,
      conversationId: targetConvId,
      role: 'user',
      content: userVoiceText,
      createdAt: Date.now(),
    };
    await db.messages.add(userMsg);

    const aiMsgId = 'msg_' + (Date.now() + 1) + '_' + Math.random().toString(36).substring(2, 6);
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      conversationId: targetConvId,
      role: 'model',
      content: aiVoiceText,
      createdAt: Date.now() + 1,
      keyLabel: 'Live API',
      modelDisplayName: modelName,
    };
    await db.messages.add(aiMsg);
    setMessages((prev) => [...prev, userMsg, aiMsg]);
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const conversationTitle = activeConversation ? activeConversation.title : 'New Chat';

  return (
    <div className="app-root-container">
      {/* Sidebar: Desktop 280px, Phone Drawer */}
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenStudio={handleOpenStudio}
        onOpenModules={() => setIsSettingsOpen(true)}
        keys={keys}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Column */}
      <div className="app-main-column">
        {/* Header with Model Pill, Live Key Health Pill, and Studio Lab Button */}
        <Header
          conversationTitle={conversationTitle}
          onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenModelPicker={() => setIsModelPickerOpen(true)}
          onOpenStudio={handleOpenStudio}
          keys={keys}
          selectedModel={selectedModel}
        />

        {/* Gentle non-blocking banner for preparing studio modules */}
        <div className="pt-3">
          <PrepareStudioCard onOpenModulesModal={() => setIsSettingsOpen(true)} />
        </div>

        {/* Chat Area */}
        <ChatArea
          messages={messages}
          isStreaming={isStreaming}
          streamingMessage={streamingText}
          streamingStatusText={streamingStatus}
          streamingKeyLabel={streamingKeyLabel}
          streamingModelDisplayName={streamingModelDisplayName}
          error={chatError}
          onSendMessage={handleSendMessage}
          onStopStreaming={handleStopStreaming}
          onRetryLast={handleRetryLast}
          onDeleteMessage={handleDeleteMessage}
          isOnline={isOnline}
          onOpenLiveVoice={() => setIsLiveVoiceOpen(true)}
        />
      </div>

      {/* Studio Modal (Video & Image Lab) */}
      <StudioModal
        isOpen={isStudioOpen}
        onClose={() => setIsStudioOpen(false)}
        activeKeySecret={activeKeySecret}
      />

      {/* Model Picker Popover / Bottom Sheet */}
      <ModelPicker
        isOpen={isModelPickerOpen}
        onClose={() => setIsModelPickerOpen(false)}
        selectedModel={selectedModel}
        onSelectModel={(modelId) => {
          setSelectedModel(modelId);
          db.settings.put({ key: 'selected_model', value: modelId });
        }}
        keys={keys}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Live Voice Modal */}
      <LiveVoiceModal
        isOpen={isLiveVoiceOpen}
        onClose={() => setIsLiveVoiceOpen(false)}
        onTranscriptReceived={handleLiveTranscriptReceived}
        keys={keys}
      />

      {/* Onboarding Modal */}
      {isOnboardingOpen && (
        <OnboardingModal
          onKeyAdded={async () => {
            setIsOnboardingOpen(false);
            await refreshKeys();
          }}
        />
      )}

      {/* Passphrase Unlock Modal */}
      {isPassphraseRequired && (
        <PassphraseModal
          onUnlocked={async () => {
            setIsPassphraseRequired(false);
            await refreshKeys();
          }}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        keys={keys}
        onKeysChanged={refreshKeys}
        theme={theme}
        onThemeChange={setTheme}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}
