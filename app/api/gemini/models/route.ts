import { NextRequest, NextResponse } from 'next/server';
import { getServerGeminiClient } from '@/lib/server/gemini';
import { classifyGeminiError } from '@/lib/errorClassification';
import { categorizeModel } from '@/lib/modelRanking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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

    const ai = getServerGeminiClient(customApiKey);

    // Fetch models live directly from Google Gemini API
    const apiModelsPager = await ai.models.list({ config: { pageSize: 100 } });
    const fetched: any[] = [];

    for await (const m of apiModelsPager) {
      if (m && m.name) {
        const rawM = m as any;
        const categorized = categorizeModel({
          name: m.name,
          displayName: m.displayName,
          description: m.description,
          supportedGenerationMethods: rawM.supportedGenerationMethods || rawM.supportedActions || [],
        });
        fetched.push(categorized);
      }
    }

    return NextResponse.json({
      models: fetched,
      count: fetched.length,
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
