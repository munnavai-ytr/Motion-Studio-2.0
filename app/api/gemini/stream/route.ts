import { NextRequest, NextResponse } from 'next/server';
import { getServerGeminiClient } from '@/lib/server/gemini';
import { classifyGeminiError } from '@/lib/errorClassification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface HistoryMessage {
  role: 'user' | 'model';
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const customApiKey = req.headers.get('x-goog-api-key')?.trim();

    if (!customApiKey) {
      return NextResponse.json(
        {
          error: 'No API key provided. Please configure your Gemini API key in Settings.',
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

    const { prompt, history = [], model, systemInstruction } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        {
          error: 'Missing prompt string in request body',
          code: 'bad_request',
        },
        { status: 400 }
      );
    }

    // Never rewrite the user's chosen model on the server!
    // Simply strip any 'models/' prefix to match the Google GenAI format.
    const targetModel = (model || '').replace(/^models\//, '').trim();
    if (!targetModel) {
      return NextResponse.json(
        {
          error: 'Missing model specification in request body',
          code: 'bad_request',
        },
        { status: 400 }
      );
    }

    const ai = getServerGeminiClient(customApiKey);

    // Format contents array for @google/genai SDK
    const formattedContents = [
      ...history.map((msg: HistoryMessage) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      })),
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];

    let streamResponse;
    try {
      streamResponse = await ai.models.generateContentStream({
        model: targetModel,
        contents: formattedContents,
        config: {
          systemInstruction:
            systemInstruction ||
            'You are Motion Studio, an intelligent, elegant, and concise AI assistant. You provide high-quality responses in English and Bengali with full Unicode typographic fidelity.',
        },
      });
    } catch (initialErr: any) {
      // Catch pre-stream failures (e.g. 401 invalid key, 404 model not found, 429 rate limit, 503 overloaded)
      const classified = classifyGeminiError(initialErr);
      return NextResponse.json(
        {
          error: classified.error,
          code: classified.code,
          retryAfterSec: classified.retryAfterSec,
        },
        { status: classified.statusCode }
      );
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamResponse) {
            const textChunk = chunk.text;
            if (textChunk) {
              const payload = `data: ${JSON.stringify({ text: textChunk })}\n\n`;
              controller.enqueue(encoder.encode(payload));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (streamErr: any) {
          // Mid-stream error: send structured error payload
          const classified = classifyGeminiError(streamErr);
          const errPayload = `data: ${JSON.stringify({
            error: classified.error,
            code: classified.code,
            retryAfterSec: classified.retryAfterSec,
          })}\n\n`;
          controller.enqueue(encoder.encode(errPayload));
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
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
