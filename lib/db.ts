import Dexie, { type Table } from 'dexie';
import type { Conversation, ChatMessage, SettingItem, StoredKey, StoredModule, StoredFile } from './types';

export class MotionStudioDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<ChatMessage, string>;
  settings!: Table<SettingItem, string>;
  keys!: Table<StoredKey, string>;
  modules!: Table<StoredModule, string>;
  files!: Table<StoredFile, string>;

  constructor() {
    super('MotionStudioDB');
    this.version(1).stores({
      conversations: 'id, createdAt, updatedAt',
      messages: 'id, conversationId, role, createdAt',
      settings: 'key',
      keys: 'id, state, createdAt'
    });
    this.version(2).stores({
      modules: 'id, status, version',
      files: 'id, type, createdAt'
    });
  }
}

export const db = new MotionStudioDatabase();

