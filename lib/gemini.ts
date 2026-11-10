import { db } from './db';
import { decryptKeyText, encryptKeyText } from './crypto';
import { appEvents } from './events';
import { classifyGeminiError, getFriendlyErrorMessage } from './errorClassification';
import { rankChatModels, categorizeModel } from './modelRanking';
import type {
  ChatMessage,
  KeyModelInfo,
  StoredKey,
  KeyHealthStatus,
  ClassifiedError,
} from './types';

export const AUTO_MODEL_ID = 'auto';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onKeyUsed: (keyLabel: string, modelName?: string, modelDisplayName?: string) => void;
  onKeySwitched?: (fromKeyLabel: string, toKeyLabel: string, reason: string) => void;
  onStatusChange?: (status: string) => void;
  onRetryCountdown?: (secondsLeft: number) => void;
}

// In-flight background health checks deduplication map
const inFlightChecks = new Map<string, Promise<StoredKey | null>>();

/**
 * Migration on startup: resets old 'error' and 'rate-limited' keys to 'checking'
 * and clears legacy cooldowns.
 */
export async function runStartupMigration(): Promise<void> {
  try {
    const allKeys = await db.keys.toArray();
    for (const k of allKeys) {
      let needsUpdate = false;
      const updates: Partial<StoredKey> = {};

      if (k.state === 'error' || k.state === 'rate-limited') {
        updates.state = 'checking';
        updates.healthStatus = 'checking';
        updates.cooldownUntil = null;
        updates.modelCooldowns = {};
        needsUpdate = true;
      }

      if (!k.modelCooldowns || typeof k.modelCooldowns !== 'object') {
        updates.modelCooldowns = {};
        needsUpdate = true;
      }

      if (!k.healthStatus) {
        updates.healthStatus = k.state === 'invalid' ? 'invalid' : 'checking';
        needsUpdate = true;
      }

      if (needsUpdate) {
        await db.keys.update(k.id, updates);
      }
    }
  } catch (err) {
    console.error('Failed to run startup migration:', err);
  }
}

/**
 * Adds a new Gemini API key. Saves immediately and connects automatically
 * with no manual test-first requirement. Runs a background health check immediately.
 */
export async function addNewKey(rawKey: string, customLabel?: string): Promise<StoredKey> {
  const cleanKey = rawKey.trim();
  if (!cleanKey) {
    throw new Error('Please enter a valid Gemini API key.');
  }

  const { encryptedKey, iv } = await encryptKeyText(cleanKey);
  const last4 = cleanKey.length >= 4 ? cleanKey.slice(-4) : cleanKey;

  const newKeyRecord: StoredKey = {
    id: 'key_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    label: customLabel?.trim() || `Key ...${last4}`,
    encryptedKey,
    iv,
    last4,
    state: 'checking',
    healthStatus: 'checking',
    cooldownUntil: null,
    modelCooldowns: {},
    models: [],
    requestCount: 0,
    createdAt: Date.now(),
  };

  await db.keys.add(newKeyRecord);
  appEvents.emit('keys:changed');

  // Trigger background check (no generation quota used)
  checkKeyHealth(newKeyRecord.id).catch(() => {});

  return newKeyRecord;
}

/**
 * Checks a single key in the background by querying the models list.
 * Deduplicated so it never runs in parallel for the same key.
 */
export async function checkKeyHealth(keyId: string): Promise<StoredKey | null> {
  if (inFlightChecks.has(keyId)) {
    return inFlightChecks.get(keyId)!;
  }

  const checkPromise = (async () => {
    try {
      const keyRecord = await db.keys.get(keyId);
      if (!keyRecord) return null;

      // Update state to checking if currently healthy or checking
      if (keyRecord.healthStatus !== 'checking') {
        await db.keys.update(keyId, { healthStatus: 'checking' });
        appEvents.emit('keys:changed');
      }

      let plainKey = '';
      try {
        plainKey = await decryptKeyText(keyRecord.encryptedKey, keyRecord.iv);
      } catch (decryptErr: any) {
        await db.keys.update(keyId, {
          healthStatus: 'error',
          errorMessage: 'Failed to decrypt key locally. Please verify session passphrase.',
          lastChecked: Date.now(),
        });
        appEvents.emit('keys:changed');
        return (await db.keys.get(keyId)) || null;
      }

      const startTime = performance.now();
      let response: Response;
      try {
        response = await fetch('/api/gemini/models', {
          headers: {
            'x-goog-api-key': plainKey,
          },
        });
      } catch (netErr: any) {
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        await db.keys.update(keyId, {
          healthStatus: isOffline ? 'offline' : keyRecord.healthStatus,
          errorMessage: isOffline ? 'Offline' : 'Network error reaching Gemini models endpoint',
          lastChecked: Date.now(),
        });
        appEvents.emit('keys:changed');
        return (await db.keys.get(keyId)) || null;
      }

      const responseTimeMs = Math.round(performance.now() - startTime);

      if (response.ok) {
        const data = await response.json();
        const models: KeyModelInfo[] = Array.isArray(data.models) ? data.models : [];

        await db.keys.update(keyId, {
          state: 'active',
          healthStatus: 'healthy',
          models,
          responseTimeMs,
          lastChecked: Date.now(),
          errorMessage: undefined,
        });
        appEvents.emit('keys:changed');
        return (await db.keys.get(keyId)) || null;
      }

      let errorData: any = {};
      try {
        errorData = await response.json();
      } catch {
        errorData = {};
      }

      const classified: ClassifiedError = classifyGeminiError({
        status: response.status,
        message: errorData.error,
        code: errorData.code,
      });

      // KEY HEALTH MUST NEVER BE CHANGED BY A MODEL-LEVEL ERROR!
      // Only a real invalid-key response marks a key Invalid.
      if (classified.code === 'invalid_key') {
        await db.keys.update(keyId, {
          state: 'invalid',
          healthStatus: 'invalid',
          errorMessage: classified.error,
          responseTimeMs,
          lastChecked: Date.now(),
        });
      } else if (classified.code === 'rate_limit') {
        // Models endpoint rate limit -> key is still valid, but limited
        await db.keys.update(keyId, {
          healthStatus: 'limited',
          errorMessage: classified.error,
          responseTimeMs,
          lastChecked: Date.now(),
        });
      } else {
        // Other non-fatal errors (e.g. 503, network): keep key active/healthy so it can still be tried
        await db.keys.update(keyId, {
          errorMessage: classified.error,
          responseTimeMs,
          lastChecked: Date.now(),
        });
      }

      appEvents.emit('keys:changed');
      return (await db.keys.get(keyId)) || null;
    } catch (err: any) {
      console.error('Error during key health check:', err);
      return null;
    } finally {
      inFlightChecks.delete(keyId);
    }
  })();

  inFlightChecks.set(keyId, checkPromise);
  return checkPromise;
}

/**
 * Checks all configured keys in background. Deduplicated.
 */
export async function checkAllKeysHealth(): Promise<void> {
  const allKeys = await db.keys.toArray();
  await Promise.all(allKeys.map((k) => checkKeyHealth(k.id)));
}

/**
 * Renames a stored key.
 */
export async function renameKey(keyId: string, newLabel: string): Promise<void> {
  const clean = newLabel.trim();
  if (!clean) return;
  await db.keys.update(keyId, { label: clean });
  appEvents.emit('keys:changed');
}

/**
 * Checks if a key is currently cooling down for a specific model.
 */
export function isKeyCoolingDownForModel(key: StoredKey, modelId: string): boolean {
  const cleanModel = modelId.replace(/^models\//, '');
  const cooldownTimestamp = key.modelCooldowns?.[cleanModel];
  if (!cooldownTimestamp) return false;
  return Date.now() < cooldownTimestamp;
}

/**
 * Sets cooldown for a specific key AND a specific model.
 */
export async function setKeyModelCooldown(
  keyId: string,
  modelId: string,
  cooldownSeconds: number
): Promise<void> {
  const cleanModel = modelId.replace(/^models\//, '');
  const keyRecord = await db.keys.get(keyId);
  if (!keyRecord) return;

  const cooldowns = { ...(keyRecord.modelCooldowns || {}) };
  cooldowns[cleanModel] = Date.now() + Math.max(cooldownSeconds, 5) * 1000;

  await db.keys.update(keyId, {
    modelCooldowns: cooldowns,
    // Note: do not set key.state = 'invalid' or 'error'
  });
  appEvents.emit('keys:changed');
}

/**
 * Returns seconds left on cooldown for a key and model (0 if ready).
 */
export function getModelCooldownSecondsLeft(key: StoredKey, modelId: string): number {
  const cleanModel = modelId.replace(/^models\//, '');
  const cooldownTimestamp = key.modelCooldowns?.[cleanModel];
  if (!cooldownTimestamp) return 0;
  return Math.max(0, Math.ceil((cooldownTimestamp - Date.now()) / 1000));
}

/**
 * Checks if a model is currently busy (cooling down) across all keys that have it.
 */
export function isModelBusyAcrossAllKeys(
  keys: StoredKey[],
  modelId: string
): { isBusy: boolean; minSecondsLeft: number } {
  const cleanModel = modelId.replace(/^models\//, '');
  const eligibleKeys = keys.filter((k) => k.state !== 'invalid');
  if (eligibleKeys.length === 0) return { isBusy: false, minSecondsLeft: 0 };

  const supportingKeys = eligibleKeys.filter(
    (k) => !k.models || k.models.length === 0 || k.models.some((m) => m.id === cleanModel)
  );

  if (supportingKeys.length === 0) return { isBusy: false, minSecondsLeft: 0 };

  const cooldownsLeft = supportingKeys.map((k) => getModelCooldownSecondsLeft(k, cleanModel));
  const allCoolingDown = cooldownsLeft.every((sec) => sec > 0);

  if (allCoolingDown) {
    return {
      isBusy: true,
      minSecondsLeft: Math.min(...cooldownsLeft),
    };
  }

  return { isBusy: false, minSecondsLeft: 0 };
}

/**
 * Aggregates and ranks all unique chat models across the user's non-invalid keys.
 */
export function getAvailableChatModels(keys: StoredKey[]): KeyModelInfo[] {
  const validKeys = keys.filter((k) => k.state !== 'invalid');
  const allModels: KeyModelInfo[] = [];

  for (const k of validKeys) {
    if (Array.isArray(k.models)) {
      allModels.push(...k.models);
    }
  }

  return rankChatModels(allModels);
}

/**
 * Gets the current best model for "Auto" selection.
 */
export function getAutoBestModel(keys: StoredKey[]): KeyModelInfo | null {
  const chatModels = getAvailableChatModels(keys);
  return chatModels.length > 0 ? chatModels[0] : null;
}

let rotationIndex = 0;

function formatHistoryForServer(messages: ChatMessage[]) {
  return messages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    content: msg.content,
  }));
}

/**
 * Core chat generation with automatic key rotation and model fallback.
 * Strictly uses only user keys; no server key fallback.
 */
export async function streamGeminiChat(
  history: ChatMessage[],
  userPrompt: string,
  requestedModel: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<{ fullText: string; keyUsedLabel: string; modelName: string; modelDisplayName?: string }> {
  // 1. Fetch current keys from Dexie
  const allKeys = await db.keys.toArray();

  if (allKeys.length === 0) {
    throw new Error('No API keys configured. Please add your Gemini API key in Settings.');
  }

  const validKeys = allKeys.filter((k) => k.state !== 'invalid');
  if (validKeys.length === 0) {
    throw new Error('All configured API keys are invalid or unauthorized. Please check your keys in Settings.');
  }

  // 2. Determine candidate models
  let candidateModels: KeyModelInfo[] = [];

  if (!requestedModel || requestedModel === AUTO_MODEL_ID) {
    // In Auto mode: get ranked chat models (up to 5 candidates)
    const availableChatModels = getAvailableChatModels(validKeys);
    if (availableChatModels.length > 0) {
      candidateModels = availableChatModels.slice(0, 5);
    } else {
      // If models haven't been fetched yet, check keys now
      await checkAllKeysHealth();
      const updatedKeys = await db.keys.toArray();
      const refreshed = getAvailableChatModels(updatedKeys);
      candidateModels = refreshed.length > 0 ? refreshed.slice(0, 5) : [];
    }
  } else {
    // Specific model requested
    const cleanReq = requestedModel.replace(/^models\//, '');
    const foundModel = validKeys
      .flatMap((k) => k.models || [])
      .find((m) => m.id === cleanReq);

    candidateModels = [
      foundModel || {
        id: cleanReq,
        rawName: requestedModel,
        displayName: cleanReq,
        category: 'chat',
        supportedActions: ['generateContent'],
      },
    ];
  }

  if (candidateModels.length === 0) {
    throw new Error(
      'No compatible chat models found on your configured keys. Please ensure your API keys have access to Gemini models.'
    );
  }

  const MAX_ATTEMPTS = Math.max(validKeys.length * candidateModels.length * 2, 6);
  let totalAttempts = 0;
  let lastClassifiedError: ClassifiedError | null = null;

  // 3. Try candidate models in order (Auto fallback)
  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const currentCandidate = candidateModels[mIdx];
    const candidateId = currentCandidate.id;

    if (signal?.aborted) {
      throw new DOMException('Request aborted by user', 'AbortError');
    }

    if (mIdx > 0) {
      callbacks.onStatusChange?.(`Switching to next best model (${currentCandidate.displayName})...`);
    }

    // Refresh keys from DB for up-to-date cooldowns
    const freshKeys = await db.keys.toArray();
    const nonInvalidKeys = freshKeys.filter((k) => k.state !== 'invalid');

    // Filter keys that support this model and are not cooling down for it
    const candidateEligibleKeys = nonInvalidKeys.filter((k) => {
      // Check if key supports this model
      const supportsModel = !k.models || k.models.length === 0 || k.models.some((m) => m.id === candidateId);
      if (!supportsModel) return false;
      // Check cooldown
      return !isKeyCoolingDownForModel(k, candidateId);
    });

    if (candidateEligibleKeys.length === 0) {
      // All keys for this candidate model are in cooldown or unsupported
      const { minSecondsLeft } = isModelBusyAcrossAllKeys(nonInvalidKeys, candidateId);
      lastClassifiedError = {
        error: `Rate limit reached for ${currentCandidate.displayName}. Next key recovers in ~${minSecondsLeft || 30}s.`,
        code: 'rate_limit',
        retryAfterSec: minSecondsLeft || 30,
        statusCode: 429,
      };

      // If there's another candidate model in Auto mode, try it
      if (mIdx < candidateModels.length - 1) {
        continue;
      }
      break;
    }

    // Rotate through candidate eligible keys
    for (let kStep = 0; kStep < candidateEligibleKeys.length; kStep++) {
      if (signal?.aborted) {
        throw new DOMException('Request aborted by user', 'AbortError');
      }

      totalAttempts++;
      if (totalAttempts > MAX_ATTEMPTS) {
        break;
      }

      rotationIndex = rotationIndex % candidateEligibleKeys.length;
      const keyItem = candidateEligibleKeys[rotationIndex];
      rotationIndex = (rotationIndex + 1) % candidateEligibleKeys.length;

      const keyLabel = keyItem.label || `Key ...${keyItem.last4}`;

      let plainKey = '';
      try {
        plainKey = await decryptKeyText(keyItem.encryptedKey, keyItem.iv);
      } catch {
        continue;
      }

      callbacks.onKeyUsed(keyLabel, candidateId, currentCandidate.displayName);
      callbacks.onStatusChange?.(`Connecting via ${keyLabel}...`);

      let response: Response;
      try {
        response = await fetch('/api/gemini/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': plainKey,
          },
          body: JSON.stringify({
            prompt: userPrompt,
            history: formatHistoryForServer(history),
            model: candidateId,
          }),
          signal,
        });
      } catch (networkErr: any) {
        if (signal?.aborted) {
          throw new DOMException('Request aborted by user', 'AbortError');
        }
        // Set short cooldown on this key+model
        await setKeyModelCooldown(keyItem.id, candidateId, 10);
        lastClassifiedError = {
          error: 'Network connection failed.',
          code: 'network',
          statusCode: 503,
        };
        continue;
      }

      if (!response.ok) {
        let errJson: any = {};
        try {
          errJson = await response.json();
        } catch {
          errJson = {};
        }

        const classified = classifyGeminiError({
          status: response.status,
          message: errJson.error,
          code: errJson.code,
          retryAfterSec: errJson.retryAfterSec,
        });
        lastClassifiedError = classified;

        // KEY HEALTH RULE:
        // Only a real invalid-key response marks a key Invalid.
        if (classified.code === 'invalid_key') {
          await db.keys.update(keyItem.id, {
            state: 'invalid',
            healthStatus: 'invalid',
            errorMessage: classified.error,
          });
          appEvents.emit('keys:changed');
          continue;
        }

        // 429 only sets cooldown for that key AND that model
        if (classified.code === 'rate_limit') {
          const cooldownSec = classified.retryAfterSec || 60;
          await setKeyModelCooldown(keyItem.id, candidateId, cooldownSec);
          continue;
        }

        // 404/model_unavailable: key does not have this model
        if (classified.code === 'model_unavailable') {
          // Set long cooldown for this model on this key so it is not retried for this model
          await setKeyModelCooldown(keyItem.id, candidateId, 3600);
          continue;
        }

        // 503 overloaded: short cooldown for this key+model
        if (classified.code === 'overloaded') {
          await setKeyModelCooldown(keyItem.id, candidateId, 15);
          continue;
        }

        // 400 bad_request: stop immediately
        if (classified.code === 'bad_request') {
          throw new Error(classified.error);
        }

        // General error: short cooldown
        await setKeyModelCooldown(keyItem.id, candidateId, 10);
        continue;
      }

      // 200 OK: stream generation
      // Update key request count and lastUsed
      await db.keys.update(keyItem.id, {
        lastUsed: Date.now(),
        requestCount: (keyItem.requestCount || 0) + 1,
      });

      const streamResult = await readSseResponseStream(
        response,
        callbacks,
        keyLabel,
        candidateId,
        currentCandidate.displayName,
        signal
      );

      if (streamResult.retryWithNextKey) {
        // In-stream error happened before any text was received
        lastClassifiedError = streamResult.errorClassified || null;
        if (streamResult.errorClassified?.code === 'rate_limit') {
          await setKeyModelCooldown(
            keyItem.id,
            candidateId,
            streamResult.errorClassified.retryAfterSec || 60
          );
        } else if (streamResult.errorClassified?.code === 'invalid_key') {
          await db.keys.update(keyItem.id, {
            state: 'invalid',
            healthStatus: 'invalid',
          });
          appEvents.emit('keys:changed');
        } else {
          await setKeyModelCooldown(keyItem.id, candidateId, 15);
        }
        continue;
      }

      return {
        fullText: streamResult.fullText,
        keyUsedLabel: keyLabel,
        modelName: candidateId,
        modelDisplayName: currentCandidate.displayName,
      };
    }
  }

  // If loop completes without return, all keys and candidates are exhausted
  const finalMsg = lastClassifiedError
    ? getFriendlyErrorMessage(lastClassifiedError.code, {
        retryAfterSec: lastClassifiedError.retryAfterSec,
      })
    : 'All attempts exhausted across your configured API keys. Please verify your keys in Settings.';

  throw new Error(finalMsg);
}

/**
 * Reads the SSE stream. If in-stream error occurs:
 * - If no text has been received: sets retryWithNextKey = true so caller can switch key/model.
 * - If text has already been shown: appends " [answer was cut short]".
 */
async function readSseResponseStream(
  response: Response,
  callbacks: StreamCallbacks,
  keyUsedLabel: string,
  modelName: string,
  modelDisplayName?: string,
  signal?: AbortSignal
): Promise<{
  fullText: string;
  keyUsedLabel: string;
  retryWithNextKey?: boolean;
  errorClassified?: ClassifiedError;
}> {
  if (!response.body) {
    throw new Error('Server response has no body stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullAccumulatedText = '';
  let hasReceivedText = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);

          // Check for in-stream error
          if (parsed.error) {
            const classified = classifyGeminiError({
              message: parsed.error,
              code: parsed.code,
              retryAfterSec: parsed.retryAfterSec,
            });

            if (!hasReceivedText) {
              // No text shown yet -> trigger retry on next key/model
              return {
                fullText: '',
                keyUsedLabel,
                retryWithNextKey: true,
                errorClassified: classified,
              };
            } else {
              // Text was already shown -> inform user answer was cut short
              const cutShortNote = '\n\n*[The response was cut short due to an interruption from the Gemini stream]*';
              fullAccumulatedText += cutShortNote;
              callbacks.onChunk(cutShortNote);
              return {
                fullText: fullAccumulatedText,
                keyUsedLabel,
              };
            }
          }

          const chunkText = parsed.text;
          if (typeof chunkText === 'string') {
            hasReceivedText = true;
            fullAccumulatedText += chunkText;
            callbacks.onChunk(chunkText);
          }
        } catch {
          // ignore individual chunk parse error
        }
      }
    }

    // Process leftover buffer
    if (buffer.trim().startsWith('data:')) {
      const jsonStr = buffer.trim().slice(5).trim();
      if (jsonStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(jsonStr);
          if (typeof parsed.text === 'string') {
            hasReceivedText = true;
            fullAccumulatedText += parsed.text;
            callbacks.onChunk(parsed.text);
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      fullText: fullAccumulatedText,
      keyUsedLabel,
    };
  } catch (streamErr: any) {
    if (signal?.aborted) {
      throw new DOMException('Request aborted by user', 'AbortError');
    }
    if (!hasReceivedText) {
      return {
        fullText: '',
        keyUsedLabel,
        retryWithNextKey: true,
        errorClassified: classifyGeminiError(streamErr),
      };
    }
    throw streamErr;
  }
}

/**
 * Returns the decrypted plaintext secret of the first available active user key.
 */
export async function getFirstDecryptedKeySecret(): Promise<string | undefined> {
  try {
    const allKeys = await db.keys.toArray();
    const candidateKeys = allKeys.filter((k) => k.state === 'active')
      .concat(allKeys.filter((k) => k.state !== 'active' && k.state !== 'invalid'));

    for (const key of candidateKeys) {
      try {
        const plain = await decryptKeyText(key.encryptedKey, key.iv);
        if (plain && plain.trim().length > 0) {
          return plain.trim();
        }
      } catch {
        // Continue to next key
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

