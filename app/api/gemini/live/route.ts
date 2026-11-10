import { NextRequest, NextResponse } from 'next/server';
import { getServerGeminiClient } from '@/lib/server/gemini';
import { classifyGeminiError } from '@/lib/errorClassification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const customApiKey = req.headers.get('x-goog-api-key')?.trim();

    if (!customApiKey) {
      return NextResponse.json(
        {
          error: 'No API key provided. Please pass an API key in the x-goog-api-key header.',
          code: 'no_key',
        },
        { status: 401 }
      );
    }

    let body: any = {};
    try {
      const rawText = await req.text();
      if (rawText) body = JSON.parse(rawText);
    } catch {
      body = {};
    }

    const { audioData, prompt, model, mimeType = 'audio/webm' } = body;

    const parts: any[] = [];
    if (audioData) {
      parts.push({
        inlineData: {
          mimeType,
          data: audioData,
        },
      });
    }
    if (prompt) {
      parts.push({ text: prompt });
    }

    if (parts.length === 0) {
      return NextResponse.json(
        { error: 'No audio or prompt provided for Live interaction', code: 'bad_request' },
        { status: 400 }
      );
    }

    const targetModel = (model || '').replace(/^models\//, '').trim();
    if (!targetModel) {
      return NextResponse.json(
        { error: 'No model specified for Live interaction', code: 'bad_request' },
        { status: 400 }
      );
    }

    const ai = getServerGeminiClient(customApiKey);

    const response = await ai.models.generateContent({
      model: targetModel,
      contents: { parts },
      config: {
        systemInstruction:
          'You are Motion Studio Live, a real-time conversational voice and text assistant. Keep responses natural, elegant, and concise.',
      },
    });

    return NextResponse.json({
      text: response.text || '',
      model: targetModel,
    });
  } catch (err: any) {
    const classified = classifyGeminiError(err);
    return NextResponse.json(
      {
        error: classified.error,
        code: classified.code,
        retryAfterSec: classified.retryAfterSec,
      },
      { status: classified.statusCode }
    );
  }
}
