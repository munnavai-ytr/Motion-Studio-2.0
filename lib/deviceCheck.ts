import type { DeviceCheckResult, StorageEstimateInfo, SupportStatus } from './types.ts';

/**
 * Real device capabilities check.
 * Strictly measures browser and hardware capabilities without mock or hardcoded data.
 */
export async function checkDeviceCapabilities(): Promise<DeviceCheckResult> {
  const isBrowser = typeof window !== 'undefined';

  // 1. WebCodecs VideoEncoder with H.264 (720p and 1080p at 30 fps)
  let webCodecsH264_720p: SupportStatus = 'not-supported';
  let webCodecsH264_1080p: SupportStatus = 'not-supported';

  if (isBrowser && 'VideoEncoder' in window && typeof VideoEncoder.isConfigSupported === 'function') {
    try {
      const res720p = await VideoEncoder.isConfigSupported({
        codec: 'avc1.4d001f', // Main profile level 3.1 (720p@30)
        width: 1280,
        height: 720,
        bitrate: 3_000_000,
        framerate: 30,
      });
      webCodecsH264_720p = res720p.supported ? 'supported' : 'not-supported';
    } catch {
      // Fallback check with Baseline profile
      try {
        const fallback720 = await VideoEncoder.isConfigSupported({
          codec: 'avc1.42001f',
          width: 1280,
          height: 720,
          bitrate: 3_000_000,
          framerate: 30,
        });
        webCodecsH264_720p = fallback720.supported ? 'supported' : 'not-supported';
      } catch {
        webCodecsH264_720p = 'unknown';
      }
    }

    try {
      const res1080p = await VideoEncoder.isConfigSupported({
        codec: 'avc1.4d0028', // Main profile level 4.0 (1080p@30)
        width: 1920,
        height: 1080,
        bitrate: 6_000_000,
        framerate: 30,
      });
      webCodecsH264_1080p = res1080p.supported ? 'supported' : 'not-supported';
    } catch {
      webCodecsH264_1080p = 'unknown';
    }
  }

  // 2. OffscreenCanvas
  let offscreenCanvas: SupportStatus = 'not-supported';
  if (isBrowser && typeof OffscreenCanvas !== 'undefined') {
    try {
      const testCanvas = new OffscreenCanvas(10, 10);
      const ctx = testCanvas.getContext('2d');
      offscreenCanvas = ctx ? 'supported' : 'not-supported';
    } catch {
      offscreenCanvas = 'unknown';
    }
  }

  // 3. Web Workers
  let webWorkers: SupportStatus = 'not-supported';
  if (isBrowser && typeof Worker !== 'undefined') {
    webWorkers = 'supported';
  }

  // 4. Cache Storage
  let cacheStorage: SupportStatus = 'not-supported';
  if (isBrowser && 'caches' in window) {
    cacheStorage = 'supported';
  }

  // 5. Origin Private File System (OPFS)
  let opfs: SupportStatus = 'not-supported';
  if (isBrowser && navigator.storage && typeof navigator.storage.getDirectory === 'function') {
    try {
      // Test actual directory handle access
      await navigator.storage.getDirectory();
      opfs = 'supported';
    } catch {
      opfs = 'not-supported';
    }
  }

  // 6. IndexedDB
  let indexedDBStatus: SupportStatus = 'not-supported';
  if (isBrowser && typeof indexedDB !== 'undefined') {
    indexedDBStatus = 'supported';
  }

  // 7. Storage Estimate & Persistence
  const storage: StorageEstimateInfo = {
    quotaBytes: 0,
    usageBytes: 0,
    freeBytes: 0,
    persisted: false,
  };

  if (isBrowser && navigator.storage) {
    try {
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        storage.quotaBytes = est.quota || 0;
        storage.usageBytes = est.usage || 0;
        storage.freeBytes = Math.max(0, (est.quota || 0) - (est.usage || 0));
      }
      if (typeof navigator.storage.persisted === 'function') {
        storage.persisted = await navigator.storage.persisted();
      }
    } catch {
      // ignore
    }
  }

  // 8. MediaRecorder fallback with canvas.captureStream
  let mediaRecorderFallback: SupportStatus = 'not-supported';
  let mediaRecorderMimeType: string | undefined = undefined;

  if (isBrowser && typeof MediaRecorder !== 'undefined') {
    try {
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 16;
      testCanvas.height = 16;
      if (typeof (testCanvas as any).captureStream === 'function') {
        const candidates = [
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
        ];
        for (const mime of candidates) {
          if (MediaRecorder.isTypeSupported(mime)) {
            mediaRecorderMimeType = mime;
            mediaRecorderFallback = 'supported';
            break;
          }
        }
        if (!mediaRecorderFallback && MediaRecorder.isTypeSupported('')) {
          mediaRecorderFallback = 'supported';
        }
      }
    } catch {
      mediaRecorderFallback = 'unknown';
    }
  }

  // Determine recommended render path
  let recommendedRenderPath: 'webcodecs-h264' | 'mediarecorder-fallback' | 'unsupported' = 'unsupported';
  if (
    webCodecsH264_720p === 'supported' &&
    offscreenCanvas === 'supported' &&
    webWorkers === 'supported'
  ) {
    recommendedRenderPath = 'webcodecs-h264';
  } else if (mediaRecorderFallback === 'supported') {
    recommendedRenderPath = 'mediarecorder-fallback';
  }

  return {
    webCodecsH264_720p,
    webCodecsH264_1080p,
    offscreenCanvas,
    webWorkers,
    cacheStorage,
    opfs,
    indexedDB: indexedDBStatus,
    mediaRecorderFallback,
    mediaRecorderMimeType,
    storage,
    recommendedRenderPath,
    checkedAt: Date.now(),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
