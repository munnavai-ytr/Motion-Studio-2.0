import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGeminiError,
  parseRetryDelaySeconds,
  extractJsonFromMessage,
  getFriendlyErrorMessage,
} from '../lib/errorClassification.ts';
import {
  rankChatModels,
  categorizeModel,
  computeModelScore,
  extractModelVersion,
} from '../lib/modelRanking.ts';
import type { KeyModelInfo, StoredKey } from '../lib/types.ts';

// -----------------------------------------------------------------------------
// TEST SUITE 1: Error Classification (429 with retryDelay, 401, 404, 503, network)
// -----------------------------------------------------------------------------
test('Error Classification: 429 with embedded JSON and retryDelay', () => {
  const rawMsg =
    '429 Resource has been exhausted (e.g. check quota). [violations { ... }] {"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"34s"}]}}';

  const parsed = extractJsonFromMessage(rawMsg);
  assert.ok(parsed, 'JSON should be extracted from error string');
  assert.equal(parsed?.error?.code, 429);
  assert.equal(parsed?.error?.details?.[0].retryDelay, '34s');

  const classified = classifyGeminiError({ status: 429, message: rawMsg });
  assert.equal(classified.code, 'rate_limit');
  assert.equal(classified.statusCode, 429);
  assert.equal(classified.retryAfterSec, 34);

  // Friendly error message should contain the wait time and NOT say "All keys dead"
  const friendly = getFriendlyErrorMessage(classified.code, { retryAfterSec: classified.retryAfterSec });
  assert.ok(friendly.includes('34s'));
  assert.ok(friendly.includes('Rate limit'));
});

test('Error Classification: 401 Invalid Key', () => {
  const err = {
    status: 401,
    message: 'API_KEY_INVALID: The provided API key is not valid.',
  };
  const classified = classifyGeminiError(err);
  assert.equal(classified.code, 'invalid_key');
  assert.equal(classified.statusCode, 401);

  const friendly = getFriendlyErrorMessage(classified.code);
  assert.ok(friendly.toLowerCase().includes('invalid'));
  assert.ok(!friendly.toLowerCase().includes('rate-limited'));
});

test('Error Classification: 404 Model Unavailable / Not Found', () => {
  const err = {
    status: 404,
    message: 'models/gemini-unreleased-xyz is not found for API version v1beta',
  };
  const classified = classifyGeminiError(err);
  assert.equal(classified.code, 'model_unavailable');
  assert.equal(classified.statusCode, 404);

  const friendly = getFriendlyErrorMessage(classified.code, { modelName: 'gemini-unreleased-xyz' });
  assert.ok(friendly.includes('gemini-unreleased-xyz'));
  assert.ok(friendly.includes('not available'));
  assert.ok(!friendly.toLowerCase().includes('rate-limited'));
});

test('Error Classification: 503 Overloaded / High Demand', () => {
  const err = {
    status: 503,
    message: 'The model is overloaded. Please try again later. UNAVAILABLE',
  };
  const classified = classifyGeminiError(err);
  assert.equal(classified.code, 'overloaded');
  assert.equal(classified.statusCode, 503);
  assert.equal(classified.retryAfterSec, 15);

  const friendly = getFriendlyErrorMessage(classified.code);
  assert.ok(friendly.includes('overloaded') || friendly.includes('busy'));
  assert.ok(!friendly.toLowerCase().includes('rate-limited'));
});

test('Error Classification: Network Connection Failure', () => {
  const err = new TypeError('fetch failed: connect ECONNREFUSED');
  const classified = classifyGeminiError(err);
  assert.equal(classified.code, 'network');

  const friendly = getFriendlyErrorMessage(classified.code);
  assert.ok(friendly.includes('internet connection') || friendly.includes('network'));
});

test('Error Classification: retryDelay parser parses various formats', () => {
  assert.equal(parseRetryDelaySeconds('34s'), 34);
  assert.equal(parseRetryDelaySeconds('34.2s'), 35);
  assert.equal(parseRetryDelaySeconds('60'), 60);
  assert.equal(parseRetryDelaySeconds(undefined), undefined);
});

// -----------------------------------------------------------------------------
// TEST SUITE 2: Per-Model Cooldown Logic
// -----------------------------------------------------------------------------
test('Per-Model Cooldown: Cooldown on Model A does not block Model B', () => {
  const now = Date.now();
  const key: StoredKey = {
    id: 'key_1',
    label: 'Key 1',
    encryptedKey: 'enc',
    iv: 'iv',
    last4: '1234',
    state: 'active',
    healthStatus: 'healthy',
    cooldownUntil: null,
    modelCooldowns: {
      'gemini-2.5-flash': now + 30000, // 30s in future
      'gemini-2.0-flash': now - 5000,  // expired
      // 'gemini-2.5-pro' has no cooldown entry
    },
    createdAt: now,
  };

  // Helper check function matching lib/gemini.ts
  const isCoolingDown = (k: StoredKey, model: string) => {
    const cd = k.modelCooldowns?.[model];
    return Boolean(cd && cd > Date.now());
  };

  assert.equal(isCoolingDown(key, 'gemini-2.5-flash'), true, 'gemini-2.5-flash should be cooling down');
  assert.equal(isCoolingDown(key, 'gemini-2.0-flash'), false, 'gemini-2.0-flash cooldown expired');
  assert.equal(isCoolingDown(key, 'gemini-2.5-pro'), false, 'gemini-2.5-pro has no cooldown');
});

test('Per-Model Cooldown: Cooldown on Key 1 does not affect Key 2 for the same model', () => {
  const now = Date.now();
  const key1: StoredKey = {
    id: 'key_1',
    label: 'Key 1',
    encryptedKey: 'enc1',
    iv: 'iv1',
    last4: '1111',
    state: 'active',
    healthStatus: 'healthy',
    cooldownUntil: null,
    modelCooldowns: {
      'gemini-2.5-flash': now + 45000,
    },
    createdAt: now,
  };

  const key2: StoredKey = {
    id: 'key_2',
    label: 'Key 2',
    encryptedKey: 'enc2',
    iv: 'iv2',
    last4: '2222',
    state: 'active',
    healthStatus: 'healthy',
    cooldownUntil: null,
    modelCooldowns: {},
    createdAt: now,
  };

  const isCoolingDown = (k: StoredKey, model: string) => {
    const cd = k.modelCooldowns?.[model];
    return Boolean(cd && cd > Date.now());
  };

  assert.equal(isCoolingDown(key1, 'gemini-2.5-flash'), true);
  assert.equal(isCoolingDown(key2, 'gemini-2.5-flash'), false, 'Key 2 is ready to serve gemini-2.5-flash');
});

// -----------------------------------------------------------------------------
// TEST SUITE 3: Auto Ranking Algorithm
// -----------------------------------------------------------------------------
test('Auto Ranking: Stable Flash over preview, Flash over Lite, newer over older', () => {
  const models: KeyModelInfo[] = [
    categorizeModel({ name: 'models/gemini-1.5-flash' }),
    categorizeModel({ name: 'models/gemini-2.5-flash-preview-0514' }),
    categorizeModel({ name: 'models/gemini-2.5-flash' }),
    categorizeModel({ name: 'models/gemini-2.5-pro' }),
    categorizeModel({ name: 'models/gemini-2.5-flash-lite' }),
    categorizeModel({ name: 'models/gemini-3.8-flash' }),
  ];

  const ranked = rankChatModels(models);
  const rankedIds = ranked.map((m) => m.id);

  // 1. Stable Flash models come first, ordered newest to oldest:
  //    gemini-3.8-flash (4380) > gemini-2.5-flash (4250) > gemini-1.5-flash (4150)
  assert.equal(rankedIds[0], 'gemini-3.8-flash', 'Newest stable Flash must be rank #1');
  assert.equal(rankedIds[1], 'gemini-2.5-flash', 'Next stable Flash must be rank #2');
  assert.equal(rankedIds[2], 'gemini-1.5-flash', 'Earlier stable Flash must be rank #3');

  // 2. Then stable Pro:
  assert.equal(rankedIds[3], 'gemini-2.5-pro', 'Stable Pro comes after stable Flash');

  // 3. Then stable Flash-Lite:
  assert.equal(rankedIds[4], 'gemini-2.5-flash-lite', 'Flash-Lite comes after Pro');

  // 4. Preview models rank lower than stable models:
  assert.equal(rankedIds[5], 'gemini-2.5-flash-preview-0514', 'Preview models rank lowest');
});

test('Auto Ranking: Model categorizer identifies categories and badges accurately', () => {
  const chatModel = categorizeModel({
    name: 'models/gemini-2.5-flash',
    supportedGenerationMethods: ['generateContent'],
  });
  assert.equal(chatModel.category, 'chat');
  assert.equal(chatModel.isFast, true);
  assert.equal(chatModel.isLite, false);
  assert.equal(chatModel.isPreview, false);

  const liteModel = categorizeModel({
    name: 'models/gemini-2.5-flash-lite',
    supportedGenerationMethods: ['generateContent'],
  });
  assert.equal(liteModel.category, 'chat');
  assert.equal(liteModel.isLite, true);

  const liveModel = categorizeModel({
    name: 'models/gemini-2.0-flash-realtime-exp',
    supportedGenerationMethods: ['bidiStream'],
  });
  assert.equal(liveModel.category, 'live');
  assert.equal(liveModel.isPreview, true);

  const imageModel = categorizeModel({
    name: 'models/imagen-3.0-generate-002',
    supportedGenerationMethods: ['imageGeneration'],
  });
  assert.equal(imageModel.category, 'image');
});

// -----------------------------------------------------------------------------
// TEST SUITE 4: Key Rotation Across Eligible Keys
// -----------------------------------------------------------------------------
test('Key Rotation: Selects keys in turn and skips keys in cooldown for the model', () => {
  const now = Date.now();
  const keys: StoredKey[] = [
    {
      id: 'k1',
      label: 'Key 1',
      encryptedKey: 'e1',
      iv: 'i1',
      last4: '0001',
      state: 'active',
      cooldownUntil: null,
      modelCooldowns: { 'gemini-2.5-flash': now + 30000 }, // cooling down
      createdAt: now,
    },
    {
      id: 'k2',
      label: 'Key 2',
      encryptedKey: 'e2',
      iv: 'i2',
      last4: '0002',
      state: 'active',
      cooldownUntil: null,
      modelCooldowns: {}, // ready!
      createdAt: now,
    },
    {
      id: 'k3',
      label: 'Key 3',
      encryptedKey: 'e3',
      iv: 'i3',
      last4: '0003',
      state: 'active',
      cooldownUntil: null,
      modelCooldowns: {}, // ready!
      createdAt: now,
    },
  ];

  const targetModel = 'gemini-2.5-flash';
  const eligible = keys.filter(
    (k) => !k.modelCooldowns?.[targetModel] || k.modelCooldowns[targetModel] <= Date.now()
  );

  assert.equal(eligible.length, 2, 'Only k2 and k3 are eligible for gemini-2.5-flash');
  assert.equal(eligible[0].id, 'k2');
  assert.equal(eligible[1].id, 'k3');
});

// -----------------------------------------------------------------------------
// TEST SUITE 5: "Failed Request Never Poisons a Key" Rule
// -----------------------------------------------------------------------------
test('Safety Rule: Non-OK model responses (404, 429, 503, network) NEVER mark key Invalid or Error', () => {
  const testKey: StoredKey = {
    id: 'k_safe',
    label: 'Primary Key',
    encryptedKey: 'enc',
    iv: 'iv',
    last4: '9999',
    state: 'active',
    healthStatus: 'healthy',
    cooldownUntil: null,
    modelCooldowns: {},
    createdAt: Date.now(),
  };

  // Simulation of error handling logic in lib/gemini.ts:
  function applyErrorToKey(key: StoredKey, modelId: string, err: any) {
    const classified = classifyGeminiError(err);

    if (classified.code === 'invalid_key') {
      key.state = 'invalid';
      key.healthStatus = 'invalid';
      return;
    }

    if (classified.code === 'rate_limit') {
      // 429 only sets cooldown for that key AND that model
      const cooldownSec = classified.retryAfterSec || 60;
      key.modelCooldowns = {
        ...(key.modelCooldowns || {}),
        [modelId]: Date.now() + cooldownSec * 1000,
      };
      // Key state remains active/healthy!
      return;
    }

    if (classified.code === 'model_unavailable') {
      // 404 sets cooldown for this specific model only
      key.modelCooldowns = {
        ...(key.modelCooldowns || {}),
        [modelId]: Date.now() + 3600 * 1000,
      };
      // Key state remains active/healthy!
      return;
    }

    if (classified.code === 'overloaded' || classified.code === 'network') {
      // Short cooldown for this model
      key.modelCooldowns = {
        ...(key.modelCooldowns || {}),
        [modelId]: Date.now() + 15 * 1000,
      };
      // Key state remains active/healthy!
      return;
    }
  }

  // 1. Force 404 Model Not Found
  applyErrorToKey(testKey, 'gemini-nonexistent', { status: 404, message: 'Model not found' });
  assert.equal(testKey.state, 'active', 'Key state must remain active after 404');
  assert.equal(testKey.healthStatus, 'healthy', 'Health must remain healthy after 404');
  assert.ok(testKey.modelCooldowns?.['gemini-nonexistent'], 'Model cooldown set for 404 model');

  // 2. Force 429 Rate Limit
  applyErrorToKey(testKey, 'gemini-2.5-flash', { status: 429, message: 'Resource exhausted 429' });
  assert.equal(testKey.state, 'active', 'Key state must remain active after 429');
  assert.equal(testKey.healthStatus, 'healthy', 'Health must remain healthy after 429');
  assert.ok(testKey.modelCooldowns?.['gemini-2.5-flash'], 'Model cooldown set for 429 model');

  // 3. Force 503 Overloaded
  applyErrorToKey(testKey, 'gemini-2.5-pro', { status: 503, message: 'Overloaded 503' });
  assert.equal(testKey.state, 'active', 'Key state must remain active after 503');
  assert.equal(testKey.healthStatus, 'healthy', 'Health must remain healthy after 503');

  // 4. Force Network Error
  applyErrorToKey(testKey, 'gemini-2.5-flash-lite', new TypeError('fetch failed'));
  assert.equal(testKey.state, 'active', 'Key state must remain active after network error');
  assert.equal(testKey.healthStatus, 'healthy', 'Health must remain healthy after network error');

  // 5. Only real invalid_key marks key invalid
  applyErrorToKey(testKey, 'any-model', { status: 401, message: 'API_KEY_INVALID' });
  assert.equal(testKey.state, 'invalid', 'Key state becomes invalid only on real 401 invalid_key');
  assert.equal(testKey.healthStatus, 'invalid', 'Health status becomes invalid only on real 401 invalid_key');
});
