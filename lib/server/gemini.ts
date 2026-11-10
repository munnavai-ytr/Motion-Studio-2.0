import { GoogleGenAI } from '@google/genai';

/**
 * Initializes a GoogleGenAI client for the given custom API key.
 * Strictly requires the caller to provide an API key (no server-side fallback).
 */
export function getServerGeminiClient(customApiKey?: string): GoogleGenAI {
  const apiKey = customApiKey?.trim();
  if (!apiKey) {
    throw new Error('NO_API_KEY_PROVIDED');
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}
