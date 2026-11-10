import type { KeyModelInfo, ModelCategory } from './types';

/**
 * Categorizes a raw model from the Gemini API into a standardized KeyModelInfo.
 */
export function categorizeModel(raw: {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}): KeyModelInfo {
  const cleanId = raw.name.replace(/^models\//, '');
  const lower = cleanId.toLowerCase();
  const methods = (raw.supportedGenerationMethods || []).map((m) => m.toLowerCase());

  let category: ModelCategory = 'other';

  const isImage =
    lower.includes('imagen') ||
    lower.includes('image-generation') ||
    methods.some((m) => m.includes('image'));

  const isLive =
    lower.includes('live') ||
    lower.includes('realtime') ||
    lower.includes('bidirectional');

  const isAudio =
    lower.includes('audio') ||
    lower.includes('tts') ||
    lower.includes('transcribe') ||
    lower.includes('speech');

  const isChat =
    !isImage &&
    !isLive &&
    !isAudio &&
    (methods.includes('generatecontent') ||
      methods.some((m) => m.includes('chat') || m.includes('content')) ||
      lower.includes('gemini'));

  if (isLive) {
    category = 'live';
  } else if (isImage) {
    category = 'image';
  } else if (isAudio) {
    category = 'audio';
  } else if (isChat) {
    category = 'chat';
  }

  const isPreview =
    lower.includes('preview') ||
    lower.includes('exp') ||
    lower.includes('experimental') ||
    lower.includes('beta');

  const isLite = lower.includes('lite');
  const isPro = lower.includes('pro') && !isLite;
  const isFast = lower.includes('flash') && !isLite;

  return {
    id: cleanId,
    rawName: raw.name,
    displayName: raw.displayName || formatDisplayName(cleanId),
    description: raw.description,
    category,
    supportedActions: raw.supportedGenerationMethods || [],
    isFast,
    isLite,
    isPro,
    isPreview,
  };
}

/**
 * Creates a clean, human-readable display name if API didn't return one.
 */
export function formatDisplayName(cleanId: string): string {
  // e.g. "gemini-2.5-flash" -> "Gemini 2.5 Flash"
  return cleanId
    .split(/[-_]/)
    .map((word) => {
      if (word === 'gemini') return 'Gemini';
      if (/^\d+(\.\d+)?$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Extracts a numeric version (e.g. 3.8, 2.5, 2.0, 1.5, 4.0) from model ID.
 */
export function extractModelVersion(id: string): number {
  const match = id.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const v = parseFloat(match[1]);
    if (!isNaN(v)) return v;
  }
  return 1.0;
}

/**
 * Computes a ranking score for a chat model:
 * Newest stable Flash first, then Pro, then Flash-Lite, then anything else;
 * preview/experimental models rank lower.
 */
export function computeModelScore(model: KeyModelInfo): number {
  const version = extractModelVersion(model.id); // e.g. 3.8, 2.5, 2.0, 1.5
  const isPreview = Boolean(model.isPreview);
  const isFlash = Boolean(model.isFast);
  const isPro = Boolean(model.isPro);
  const isLite = Boolean(model.isLite);

  let baseTier = 0;

  if (!isPreview) {
    // Stable models
    if (isFlash) {
      baseTier = 4000;
    } else if (isPro) {
      baseTier = 3000;
    } else if (isLite) {
      baseTier = 2000;
    } else {
      baseTier = 1000;
    }
  } else {
    // Preview / experimental models rank lower
    if (isFlash) {
      baseTier = 400;
    } else if (isPro) {
      baseTier = 300;
    } else if (isLite) {
      baseTier = 200;
    } else {
      baseTier = 100;
    }
  }

  // Multiply version by 100 to ensure newer versions strictly rank higher within tier
  return baseTier + Math.round(version * 100);
}

/**
 * Ranks available chat models according to the "Auto" priority:
 * Newest stable Flash > Pro > Flash-Lite > Other > Preview Flash > Preview Pro > Preview Lite.
 */
export function rankChatModels(models: KeyModelInfo[]): KeyModelInfo[] {
  const chatModels = models.filter((m) => m.category === 'chat');

  // Deduplicate by clean ID
  const uniqueMap = new Map<string, KeyModelInfo>();
  for (const m of chatModels) {
    if (!uniqueMap.has(m.id)) {
      uniqueMap.set(m.id, m);
    }
  }

  const list = Array.from(uniqueMap.values());
  return list.sort((a, b) => {
    const scoreA = computeModelScore(a);
    const scoreB = computeModelScore(b);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return a.id.localeCompare(b.id);
  });
}
