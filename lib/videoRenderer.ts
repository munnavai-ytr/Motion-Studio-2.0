import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Scene } from './types';
import { renderScene } from './sceneEngine/renderer';

export interface RenderProgress {
  frame: number;
  totalFrames: number;
  percent: number;
  fps: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
}

export interface RenderVideoOptions {
  scene: Scene;
  onProgress?: (progress: RenderProgress) => void;
  abortSignal?: AbortSignal;
}

/**
 * Path A: Hardware-accelerated WebCodecs VideoEncoder + MP4 Muxer.
 * Purely client-side, zero server dependencies, memory-efficient.
 */
export async function renderVideoWebCodecs({
  scene,
  onProgress,
  abortSignal,
}: RenderVideoOptions): Promise<Blob> {
  const { width, height, fps, duration } = scene.canvas;
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');

  if ('width' in canvas && 'height' in canvas) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: false }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for rendering');
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });

  // Select codec configuration based on resolution
  const codecString = width > 1280 || height > 720 ? 'avc1.4d0028' : 'avc1.4d001f';
  const bitrate = width > 1280 || height > 720 ? 6_000_000 : 3_000_000;

  encoder.configure({
    codec: codecString,
    width,
    height,
    bitrate,
    framerate: fps,
  });

  const startTime = performance.now();

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      if (abortSignal?.aborted) {
        throw new Error('Rendering cancelled by user');
      }
      if (encoderError) {
        throw encoderError;
      }

      const t = frame / fps;
      renderScene(scene, t, ctx);

      // Create VideoFrame from Canvas or ImageBitmap
      const timestampMicros = Math.round((frame * 1_000_000) / fps);
      const isKeyFrame = frame % (fps * 2) === 0;

      let videoFrame: VideoFrame;
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(canvas);
        videoFrame = new VideoFrame(bmp, { timestamp: timestampMicros });
        bmp.close();
      } else {
        videoFrame = new VideoFrame(canvas as any, { timestamp: timestampMicros });
      }

      encoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Drain queue to avoid memory backlog on high resolutions
      if (encoder.encodeQueueSize > 4) {
        await encoder.flush();
      }

      const elapsed = performance.now() - startTime;
      const progressPercent = Math.min(99, Math.round(((frame + 1) / totalFrames) * 100));
      const currentFps = (frame + 1) / (elapsed / 1000);
      const remainingFrames = totalFrames - (frame + 1);
      const estimatedRemainingMs = currentFps > 0 ? (remainingFrames / currentFps) * 1000 : 0;

      onProgress?.({
        frame: frame + 1,
        totalFrames,
        percent: progressPercent,
        fps: Math.round(currentFps * 10) / 10,
        elapsedMs: Math.round(elapsed),
        estimatedRemainingMs: Math.round(estimatedRemainingMs),
      });

      // Brief tick to allow UI to breathe
      if (frame % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    await encoder.flush();
    muxer.finalize();

    onProgress?.({
      frame: totalFrames,
      totalFrames,
      percent: 100,
      fps: fps,
      elapsedMs: Math.round(performance.now() - startTime),
      estimatedRemainingMs: 0,
    });

    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    try {
      if (encoder.state !== 'closed') {
        encoder.close();
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Path B: MediaRecorder fallback with canvas.captureStream.
 */
export async function renderVideoMediaRecorder({
  scene,
  onProgress,
  abortSignal,
}: RenderVideoOptions): Promise<Blob> {
  const { width, height, fps, duration } = scene.canvas;
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const stream = (canvas as any).captureStream(fps);
  const supportedMime = [
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((m) => MediaRecorder.isTypeSupported(m)) || '';

  const recorder = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const startTime = performance.now();
  recorder.start(100);

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      if (abortSignal?.aborted) {
        recorder.stop();
        throw new Error('Rendering cancelled by user');
      }

      const t = frame / fps;
      renderScene(scene, t, ctx);

      const elapsed = performance.now() - startTime;
      const progressPercent = Math.min(99, Math.round(((frame + 1) / totalFrames) * 100));
      const currentFps = (frame + 1) / (elapsed / 1000);
      const remainingFrames = totalFrames - (frame + 1);
      const estimatedRemainingMs = currentFps > 0 ? (remainingFrames / currentFps) * 1000 : 0;

      onProgress?.({
        frame: frame + 1,
        totalFrames,
        percent: progressPercent,
        fps: Math.round(currentFps * 10) / 10,
        elapsedMs: Math.round(elapsed),
        estimatedRemainingMs: Math.round(estimatedRemainingMs),
      });

      // Frame interval pacing
      await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
    }

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'video/webm';
        resolve(new Blob(chunks, { type: mime }));
      };
      recorder.onerror = (e) => reject(new Error('MediaRecorder error: ' + (e as any).message));
      recorder.stop();
    });
  } finally {
    stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
  }
}

/**
 * Exports a single frame as a high-resolution PNG Blob.
 * Supports aspect ratio scaling and custom dimensions.
 */
export async function renderStillPng({
  scene,
  t,
  targetWidth,
  targetHeight,
}: {
  scene: Scene;
  t: number;
  targetWidth?: number;
  targetHeight?: number;
}): Promise<Blob> {
  const w = targetWidth || scene.canvas.width;
  const h = targetHeight || scene.canvas.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // If resizing, scale appropriately
  if (w !== scene.canvas.width || h !== scene.canvas.height) {
    const scaleX = w / scene.canvas.width;
    const scaleY = h / scene.canvas.height;
    ctx.scale(scaleX, scaleY);
  }

  renderScene(scene, t, ctx);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to generate PNG blob'));
      }
    }, 'image/png');
  });
}
