'use client';

import React, { useState } from 'react';
import {
  Plus,
  MessageSquare,
  Settings,
  Trash2,
  Edit2,
  Check,
  X,
  Layers,
  Box,
  Video,
  Package,
} from 'lucide-react';
import type { Conversation, StoredKey } from '../lib/types';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  onOpenStudio?: () => void;
  onOpenModules?: () => void;
  keys: StoredKey[];
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings,
  onOpenStudio,
  onOpenModules,
  keys,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startEditing = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleSaveRename = (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editTitle.trim()) {
      onRenameConversation(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const activeKeysCount = keys.filter((k) => k.state === 'active').length;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside className={`app-sidebar ${isOpenMobile ? 'mobile-open' : ''}`}>
        {/* Sidebar Header */}
        <div className="sidebar-header">
          <div className="flex items-center justify-between w-full">
            <div className="brand-lockup">
              <span className="brand-dot" />
              <span className="brand-name">Motion Studio</span>
            </div>
            {isOpenMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="btn-icon md:hidden"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              onNewConversation();
              if (isOpenMobile) onCloseMobile();
            }}
            className="btn-new-chat"
            aria-label="Start a new conversation"
          >
            <Plus size={16} />
            <span>New Chat</span>
          </button>
        </div>

        {/* Conversation List */}
        <div className="sidebar-chat-list">
          <div className="sidebar-section-label">Recent Conversations</div>

          {conversations.length === 0 ? (
            <div className="sidebar-empty-state">
              <span>No conversations yet</span>
            </div>
          ) : (
            <nav className="chat-nav-list" aria-label="Conversation history">
              {conversations.map((conv) => {
                const isActive = conv.id === activeConversationId;
                const isEditing = editingId === conv.id;

                return (
                  <div
                    key={conv.id}
                    onClick={() => {
                      if (!isEditing) {
                        onSelectConversation(conv.id);
                        if (isOpenMobile) onCloseMobile();
                      }
                    }}
                    className={`chat-item-row ${isActive ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        onSelectConversation(conv.id);
                        if (isOpenMobile) onCloseMobile();
                      }
                    }}
                  >
                    <MessageSquare size={15} className="shrink-0 text-muted" />

                    {isEditing ? (
                      <form
                        onSubmit={(e) => handleSaveRename(conv.id, e)}
                        className="flex-1 flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          autoFocus
                          className="chat-rename-input"
                        />
                        <button
                          type="submit"
                          className="btn-icon-xs"
                          aria-label="Save title"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="btn-icon-xs"
                          aria-label="Cancel rename"
                        >
                          <X size={13} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="chat-item-title" title={conv.title}>
                          {conv.title}
                        </span>

                        <div className="chat-item-actions">
                          <button
                            type="button"
                            onClick={(e) => startEditing(conv, e)}
                            className="btn-icon-xs"
                            aria-label={`Rename conversation "${conv.title}"`}
                            title="Rename"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(conv.id);
                            }}
                            className="btn-icon-xs btn-icon-danger"
                            aria-label={`Delete conversation "${conv.title}"`}
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </nav>
          )}

          {/* Studio & Tools */}
          <div className="sidebar-future-section">
            <div className="sidebar-section-label">Studio & Tools</div>
            {onOpenStudio && (
              <button
                type="button"
                onClick={() => {
                  onOpenStudio();
                  if (isOpenMobile) onCloseMobile();
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold bg-[#FF5B3A]/10 hover:bg-[#FF5B3A]/20 text-[#FF5B3A] border border-[#FF5B3A]/30 transition-all mb-1.5"
                title="Launch Video & Image Lab"
              >
                <div className="flex items-center gap-2">
                  <Video size={14} />
                  <span>Studio Lab</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#FF5B3A] text-white">v2.0</span>
              </button>
            )}

            {onOpenModules && (
              <button
                type="button"
                onClick={() => {
                  onOpenModules();
                  if (isOpenMobile) onCloseMobile();
                }}
                className="future-tool-btn hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
                title="Manage local modules"
              >
                <Package size={14} />
                <span>Install Manager</span>
              </button>
            )}

            <button
              type="button"
              disabled
              className="future-tool-btn"
              title="Coming in a later push"
            >
              <Layers size={14} />
              <span>Library</span>
              <span className="future-tag">Later Push</span>
            </button>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <button
            type="button"
            onClick={() => {
              onOpenSettings();
              if (isOpenMobile) onCloseMobile();
            }}
            className="sidebar-settings-btn"
            aria-label="Open settings"
          >
            <Settings size={16} />
            <span className="flex-1 text-left">Settings</span>
            <span
              className="key-status-indicator active"
              title={activeKeysCount > 0 ? `${activeKeysCount} custom key(s) active` : 'Server-side Gemini 3.8 Flash active'}
            >
              {activeKeysCount > 0 ? `${activeKeysCount} key${activeKeysCount !== 1 ? 's' : ''}` : 'Server AI'}
            </span>
          </button>
        </div>

        {/* Delete Confirmation Modal */}
        {confirmDeleteId && (
          <div className="modal-nested-overlay" role="dialog" aria-modal="true">
            <div className="modal-confirm-box">
              <h4 className="text-sm font-semibold mb-2">Delete this conversation?</h4>
              <p className="text-xs text-muted mb-4">
                All messages in this chat will be permanently deleted.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteConversation(confirmDeleteId);
                    setConfirmDeleteId(null);
                  }}
                  className="btn-danger btn-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
