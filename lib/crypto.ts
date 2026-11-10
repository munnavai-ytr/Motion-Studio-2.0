import { db } from './db';

const VAULT_DB_NAME = 'MotionStudioCryptoVault';
const VAULT_STORE_NAME = 'device_keys';
const DEVICE_KEY_ID = 'local_device_aes_key';
const CANARY_CIPHERTEXT_KEY = 'crypto_canary_ciphertext';
const CANARY_IV_KEY = 'crypto_canary_iv';
const CANARY_PLAINTEXT = 'motion_studio_canary_v1';

// In-memory session key cache
let inMemoryCryptoKey: CryptoKey | null = null;

// Open or create the native IndexedDB store that holds the non-extractable CryptoKey
function openVaultDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('Window is undefined'));
    }
    const request = window.indexedDB.open(VAULT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const idb = request.result;
      if (!idb.objectStoreNames.contains(VAULT_STORE_NAME)) {
        idb.createObjectStore(VAULT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredDeviceCryptoKey(): Promise<CryptoKey | null> {
  const idb = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(VAULT_STORE_NAME, 'readonly');
    const store = tx.objectStore(VAULT_STORE_NAME);
    const request = store.get(DEVICE_KEY_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function saveStoredDeviceCryptoKey(key: CryptoKey): Promise<void> {
  const idb = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(VAULT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(VAULT_STORE_NAME);
    const request = store.put(key, DEVICE_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearDeviceVault(): Promise<void> {
  inMemoryCryptoKey = null;
  const idb = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(VAULT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(VAULT_STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Convert byte arrays to Base64 and back
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToBuffer(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Derive AES-GCM 256-bit key from passphrase using PBKDF2
export async function deriveKeyFromPassphrase(passphrase: string, saltHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseBytes = encoder.encode(passphrase);
  const saltBytes = new Uint8Array(
    (saltHex.match(/.{1,2}/g) || []).map((byte) => parseInt(byte, 16))
  );

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    passphraseBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Generate a random 16-byte salt as hex string
export function generateSaltHex(): string {
  const salt = new Uint8Array(16);
  window.crypto.getRandomValues(salt);
  return Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Check if app has passphrase enabled
export async function isPassphraseProtected(): Promise<boolean> {
  const setting = await db.settings.get('has_passphrase');
  return setting?.value === true;
}

// Get the active crypto key for current session
export async function getActiveCryptoKey(): Promise<CryptoKey | null> {
  if (inMemoryCryptoKey) {
    return inMemoryCryptoKey;
  }

  const isProtected = await isPassphraseProtected();
  if (isProtected) {
    // If protected, requires unlockPassphrase to be called first
    return null;
  }

  // Non-passphrase mode: Retrieve or generate non-extractable device key
  let deviceKey = await getStoredDeviceCryptoKey();
  if (!deviceKey) {
    deviceKey = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable!
      ['encrypt', 'decrypt']
    );
    await saveStoredDeviceCryptoKey(deviceKey);
  }
  inMemoryCryptoKey = deviceKey;
  return inMemoryCryptoKey;
}

// Verify and unlock session with passphrase
export async function unlockWithPassphrase(passphrase: string): Promise<boolean> {
  const saltSetting = await db.settings.get('passphrase_salt');
  if (!saltSetting?.value) {
    return false;
  }

  try {
    const candidateKey = await deriveKeyFromPassphrase(passphrase, saltSetting.value);
    
    // Check canary
    const canaryCipher = await db.settings.get(CANARY_CIPHERTEXT_KEY);
    const canaryIv = await db.settings.get(CANARY_IV_KEY);

    if (canaryCipher?.value && canaryIv?.value) {
      const ivBuffer = base64ToBuffer(canaryIv.value);
      const cipherBuffer = base64ToBuffer(canaryCipher.value);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer as unknown as BufferSource },
        candidateKey,
        cipherBuffer as unknown as BufferSource
      );
      const text = new TextDecoder().decode(decrypted);
      if (text !== CANARY_PLAINTEXT) {
        return false;
      }
    }

    inMemoryCryptoKey = candidateKey;
    return true;
  } catch {
    return false;
  }
}

// Set up or update passphrase
export async function setPassphrase(newPassphrase: string, oldPassphrase?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const isProtected = await isPassphraseProtected();
    let currentKey: CryptoKey | null = null;

    if (isProtected) {
      if (!oldPassphrase) {
        return { success: false, error: 'Current passphrase is required to change passphrase.' };
      }
      const unlocked = await unlockWithPassphrase(oldPassphrase);
      if (!unlocked) {
        return { success: false, error: 'Incorrect current passphrase.' };
      }
      currentKey = inMemoryCryptoKey;
    } else {
      currentKey = await getActiveCryptoKey();
    }

    if (!currentKey) {
      return { success: false, error: 'Could not access active encryption key.' };
    }

    // Read all keys from DB and decrypt them with currentKey
    const allStoredKeys = await db.keys.toArray();
    const decryptedKeys: Array<{ id: string; plain: string }> = [];

    for (const key of allStoredKeys) {
      const decrypted = await decryptStringWithKey(key.encryptedKey, key.iv, currentKey);
      decryptedKeys.push({ id: key.id, plain: decrypted });
    }

    // Derive new key from new passphrase
    const newSaltHex = generateSaltHex();
    const newCryptoKey = await deriveKeyFromPassphrase(newPassphrase, newSaltHex);

    // Create canary
    const canaryIv = window.crypto.getRandomValues(new Uint8Array(12));
    const canaryCipher = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: canaryIv },
      newCryptoKey,
      new TextEncoder().encode(CANARY_PLAINTEXT)
    );

    // Re-encrypt all keys
    for (const item of decryptedKeys) {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        newCryptoKey,
        new TextEncoder().encode(item.plain)
      );
      await db.keys.update(item.id, {
        encryptedKey: bufferToBase64(encrypted),
        iv: bufferToBase64(iv),
      });
    }

    // Update settings
    await db.settings.put({ key: 'has_passphrase', value: true });
    await db.settings.put({ key: 'passphrase_salt', value: newSaltHex });
    await db.settings.put({ key: CANARY_CIPHERTEXT_KEY, value: bufferToBase64(canaryCipher) });
    await db.settings.put({ key: CANARY_IV_KEY, value: bufferToBase64(canaryIv) });

    inMemoryCryptoKey = newCryptoKey;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to update passphrase.' };
  }
}

// Remove passphrase protection and return to non-extractable device key
export async function removePassphrase(currentPassphrase: string): Promise<{ success: boolean; error?: string }> {
  try {
    const unlocked = await unlockWithPassphrase(currentPassphrase);
    if (!unlocked) {
      return { success: false, error: 'Incorrect passphrase.' };
    }
    const currentKey = inMemoryCryptoKey;
    if (!currentKey) {
      return { success: false, error: 'No active session key.' };
    }

    // Decrypt all existing keys
    const allStoredKeys = await db.keys.toArray();
    const decryptedKeys: Array<{ id: string; plain: string }> = [];
    for (const key of allStoredKeys) {
      const decrypted = await decryptStringWithKey(key.encryptedKey, key.iv, currentKey);
      decryptedKeys.push({ id: key.id, plain: decrypted });
    }

    // Generate fresh non-extractable device key
    const newDeviceKey = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    await saveStoredDeviceCryptoKey(newDeviceKey);

    // Re-encrypt all keys with device key
    for (const item of decryptedKeys) {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        newDeviceKey,
        new TextEncoder().encode(item.plain)
      );
      await db.keys.update(item.id, {
        encryptedKey: bufferToBase64(encrypted),
        iv: bufferToBase64(iv),
      });
    }

    // Update settings
    await db.settings.put({ key: 'has_passphrase', value: false });
    await db.settings.delete('passphrase_salt');
    await db.settings.delete(CANARY_CIPHERTEXT_KEY);
    await db.settings.delete(CANARY_IV_KEY);

    inMemoryCryptoKey = newDeviceKey;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to remove passphrase.' };
  }
}

// Helper to decrypt string with specific CryptoKey
export async function decryptStringWithKey(encryptedBase64: string, ivBase64: string, key: CryptoKey): Promise<string> {
  const iv = base64ToBuffer(ivBase64);
  const cipher = base64ToBuffer(encryptedBase64);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    cipher as unknown as BufferSource
  );
  return new TextDecoder().decode(decrypted);
}

// Encrypt plaintext string using the current active key
export async function encryptKeyText(plainText: string): Promise<{ encryptedKey: string; iv: string }> {
  const activeKey = await getActiveCryptoKey();
  if (!activeKey) {
    throw new Error('Encryption key is locked or unavailable. Please unlock first.');
  }

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    activeKey,
    encoded
  );

  return {
    encryptedKey: bufferToBase64(encrypted),
    iv: bufferToBase64(iv),
  };
}

// Decrypt ciphertext using the current active key
export async function decryptKeyText(encryptedBase64: string, ivBase64: string): Promise<string> {
  const activeKey = await getActiveCryptoKey();
  if (!activeKey) {
    throw new Error('Encryption key is locked or unavailable. Please unlock first.');
  }
  return decryptStringWithKey(encryptedBase64, ivBase64, activeKey);
}
