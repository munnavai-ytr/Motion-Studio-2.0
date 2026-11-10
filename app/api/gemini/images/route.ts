import { NextRequest, NextResponse } from 'next/server';
import { getServerGeminiClient } from '@/lib/server/gemini';
import { classifyGeminiError } from '@/lib/errorClassification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

    const body = await req.json();
    const { prompt, model, aspectRatio } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return NextResponse.json(
        { error: 'Prompt is required and must be a non-empty string.', code: 'bad_request' },
        { status: 400 }
      );
    }

    const ai = getServerGeminiClient(customApiKey);
    const chosenModel = model || 'imagen-3.0-generate-002';
    const chosenAspectRatio = aspectRatio || '1:1';

    try {
      const response = await ai.models.generateImages({
        model: chosenModel,
        prompt: prompt.trim(),
        config: {
          numberOfImages: 1,
          aspectRatio: chosenAspectRatio as any,
          outputMimeType: 'image/png',
        },
      });

      if (
        !response ||
        !response.generatedImages ||
        response.generatedImages.length === 0 ||
        !response.generatedImages[0]?.image?.imageBytes
      ) {
        return NextResponse.json(
          {
            error: 'No image was generated. Please try a different prompt or model.',
            code: 'unknown',
          },
          { status: 500 }
        );
      }

      const imageBytesBase64 = response.generatedImages[0].image.imageBytes;

      return NextResponse.json({
        image: `data:image/png;base64,${imageBytesBase64}`,
        model: chosenModel,
        aspectRatio: chosenAspectRatio,
      });
    } catch (genErr: any) {
      const classified = classifyGeminiError(genErr);
      
      // User-friendly quota / model access message for Imagen
      let userFriendlyMessage = classified.error;
      if (classified.code === 'model_unavailable' || classified.code === 'bad_request') {
        userFriendlyMessage = `Your Gemini key does not currently have access to Imagen 3 (${chosenModel}). You can still export still frames from the scene engine.`;
      } else if (classified.code === 'rate_limit') {
        userFriendlyMessage = 'Rate limit reached for image generation. Please wait a moment and try again.';
      }

      return NextResponse.json(
        {
          error: userFriendlyMessage,
          code: classified.code,
          retryAfterSec: classified.retryAfterSec,
        },
        { status: classified.statusCode }
      );
    }
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
