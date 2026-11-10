import type { ClassifiedError, GeminiErrorCode } from './types';

interface ErrorDetails {
  '@type'?: string;
  retryDelay?: string;
  metadata?: Record<string, string>;
  reason?: string;
  domain?: string;
}

interface ParsedGoogleRpcError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: ErrorDetails[];
  };
}

/**
 * Extracts and parses JSON embedded within an error message string,
 * which Google API error messages often include.
 */
export function extractJsonFromMessage(message: string): ParsedGoogleRpcError | null {
  if (!message || typeof message !== 'string') return null;

  // First try direct JSON parse if whole message is JSON
  try {
    return JSON.parse(message);
  } catch {
    // Continue
  }

  // Look for {"error" specifically
  const errorKeyIdx = message.indexOf('{"error"');
  if (errorKeyIdx !== -1) {
    const lastBrace = message.lastIndexOf('}');
    if (lastBrace > errorKeyIdx) {
      try {
        return JSON.parse(message.substring(errorKeyIdx, lastBrace + 1));
      } catch {
        // continue to general search
      }
    }
  }

  // General search: iterate over '{' positions from right to left or left to right
  let startIdx = 0;
  while ((startIdx = message.indexOf('{', startIdx)) !== -1) {
    let endIdx = message.lastIndexOf('}');
    while (endIdx > startIdx) {
      try {
        const candidate = message.substring(startIdx, endIdx + 1);
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        // try earlier closing brace
      }
      endIdx = message.lastIndexOf('}', endIdx - 1);
    }
    startIdx++;
  }

  return null;
}

/**
 * Parses retryDelay strings (e.g. "34s", "34.5s", "120s") into seconds.
 */
export function parseRetryDelaySeconds(delayStr?: string): number | undefined {
  if (!delayStr || typeof delayStr !== 'string') return undefined;
  const match = delayStr.match(/^([\d.]+)\s*s?$/i);
  if (!match) return undefined;
  const val = parseFloat(match[1]);
  return isNaN(val) ? undefined : Math.ceil(val);
}

/**
 * Classifies any error (from @google/genai SDK, HTTP response, or network failure)
 * into a structured ClassifiedError with code, retryAfterSec, and HTTP status code.
 */
export function classifyGeminiError(err: any): ClassifiedError {
  if (!err) {
    return {
      error: 'An unknown error occurred.',
      code: 'unknown',
      statusCode: 500,
    };
  }

  // If already classified
  if (err.code && err.statusCode && typeof err.error === 'string') {
    return {
      error: err.error,
      code: err.code as GeminiErrorCode,
      retryAfterSec: err.retryAfterSec,
      statusCode: err.statusCode,
    };
  }

  const rawStatus = typeof err.status === 'number' ? err.status : undefined;
  const rawMessage = String(err.message || err.error || err || '');
  const parsedJson = extractJsonFromMessage(rawMessage);

  const jsonRpc = parsedJson?.error;
  const effectiveStatus = jsonRpc?.code || rawStatus;
  const rpcStatus = jsonRpc?.status || '';
  const detailedMessage = jsonRpc?.message || rawMessage;

  // Extract retryDelay from details if present
  let retryAfterSec: number | undefined;
  if (Array.isArray(jsonRpc?.details)) {
    for (const d of jsonRpc.details) {
      if (d.retryDelay) {
        const parsed = parseRetryDelaySeconds(d.retryDelay);
        if (parsed !== undefined) {
          retryAfterSec = parsed;
          break;
        }
      }
    }
  }

  const lowerMsg = (detailedMessage + ' ' + rpcStatus).toLowerCase();

  // 1. No key
  if (
    lowerMsg.includes('no_api_key_provided') ||
    lowerMsg.includes('no api key') ||
    lowerMsg.includes('missing api key')
  ) {
    return {
      error: 'No API key provided. Please configure your Gemini API key in Settings.',
      code: 'no_key',
      statusCode: 401,
    };
  }

  // 2. Invalid Key (401 or 403 explicitly about API key or permission denied on key)
  if (
    effectiveStatus === 401 ||
    lowerMsg.includes('api_key_invalid') ||
    lowerMsg.includes('api key not valid') ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('key expired') ||
    lowerMsg.includes('unauthenticated') ||
    (effectiveStatus === 403 &&
      (lowerMsg.includes('api key') || lowerMsg.includes('permission_denied') || lowerMsg.includes('caller does not have permission')))
  ) {
    return {
      error: 'The provided Gemini API key is invalid or unauthorized.',
      code: 'invalid_key',
      statusCode: 401,
    };
  }

  // 3. Rate Limit / Quota (429 or RESOURCE_EXHAUSTED)
  if (
    effectiveStatus === 429 ||
    rpcStatus === 'RESOURCE_EXHAUSTED' ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('quota') ||
    lowerMsg.includes('429')
  ) {
    const delay = retryAfterSec || 60;
    return {
      error: `Gemini rate limit or quota exceeded for this model. Try again in ~${delay}s.`,
      code: 'rate_limit',
      retryAfterSec: delay,
      statusCode: 429,
    };
  }

  // 4. Model Unavailable / Not Found (404 or NOT_FOUND)
  if (
    effectiveStatus === 404 ||
    rpcStatus === 'NOT_FOUND' ||
    lowerMsg.includes('not_found') ||
    lowerMsg.includes('model not found') ||
    lowerMsg.includes('is not found for api version') ||
    lowerMsg.includes('is not supported') ||
    lowerMsg.includes('does not exist')
  ) {
    return {
      error: 'The requested Gemini model is not available or not supported on this API key.',
      code: 'model_unavailable',
      statusCode: 404,
    };
  }

  // 5. Overloaded / Service Unavailable (503 or UNAVAILABLE)
  if (
    effectiveStatus === 503 ||
    rpcStatus === 'UNAVAILABLE' ||
    lowerMsg.includes('unavailable') ||
    lowerMsg.includes('high demand') ||
    lowerMsg.includes('overloaded') ||
    lowerMsg.includes('service unavailable')
  ) {
    return {
      error: 'Google Gemini servers are temporarily overloaded or experiencing high demand. Please try again shortly.',
      code: 'overloaded',
      retryAfterSec: 15,
      statusCode: 503,
    };
  }

  // 6. Bad Request (400 or INVALID_ARGUMENT)
  if (
    effectiveStatus === 400 ||
    rpcStatus === 'INVALID_ARGUMENT' ||
    lowerMsg.includes('invalid_argument') ||
    lowerMsg.includes('bad request')
  ) {
    return {
      error: detailedMessage || 'Invalid request parameters.',
      code: 'bad_request',
      statusCode: 400,
    };
  }

  // 7. Network / Connection errors
  if (
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('socket hang up') ||
    lowerMsg.includes('abort')
  ) {
    return {
      error: 'Network connection error reaching Google Gemini. Please check your internet connection.',
      code: 'network',
      statusCode: 503,
    };
  }

  // 8. Unknown fallback
  return {
    error: detailedMessage || 'An unexpected error occurred while communicating with Gemini.',
    code: 'unknown',
    statusCode: effectiveStatus && effectiveStatus >= 400 && effectiveStatus < 600 ? effectiveStatus : 500,
  };
}

/**
 * Returns a human-friendly explanation matching the real error cause.
 * Never uses the word "rate-limited" unless code is 'rate_limit'.
 */
export function getFriendlyErrorMessage(code: GeminiErrorCode, extra?: { retryAfterSec?: number; modelName?: string }): string {
  switch (code) {
    case 'no_key':
      return 'No API keys configured. Please add your Gemini API key in Settings.';
    case 'invalid_key':
      return 'Your Gemini API key is invalid or unauthorized. Please check your key in Settings.';
    case 'rate_limit': {
      const wait = extra?.retryAfterSec ? `${extra.retryAfterSec}s` : 'a few moments';
      return `Rate limit reached on Google Gemini. Next key or model will recover in ${wait}.`;
    }
    case 'model_unavailable':
      return extra?.modelName
        ? `The model "${extra.modelName}" is not available on your configured API keys.`
        : 'The selected model is not available on your API keys.';
    case 'overloaded':
      return 'Google Gemini servers are temporarily busy or experiencing high demand. Please retry shortly.';
    case 'bad_request':
      return 'Request could not be processed due to invalid parameters.';
    case 'network':
      return 'Unable to reach Gemini servers. Please check your internet connection.';
    default:
      return 'Unable to complete response. Please check your settings and try again.';
  }
}
