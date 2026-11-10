import { db } from './db';
import type {
  ModuleDefinition,
  ModulesManifest,
  StoredModule,
} from './types';

export const MODULES_CACHE_NAME = 'motion-studio-modules-v1';

/**
 * Fetches the manifest file shipped with the application (/modules.json).
 */
export async function getModulesManifest(): Promise<ModulesManifest> {
  const res = await fetch('/modules.json', { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load modules manifest: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Synchronizes manifest definitions with local Dexie db records.
 */
export async function getStoredModules(): Promise<StoredModule[]> {
  const manifest = await getModulesManifest();
  const storedList = await db.modules.toArray();
  const storedMap = new Map(storedList.map((m) => [m.id, m]));

  const result: StoredModule[] = [];

  for (const mod of manifest.modules) {
    const totalBytes = mod.files.reduce((acc, f) => acc + f.sizeBytes, 0);
    const existing = storedMap.get(mod.id);

    if (existing) {
      // Check if version updated in manifest
      if (existing.version !== mod.version && existing.status === 'installed') {
        const updated: StoredModule = {
          ...existing,
          version: mod.version,
          status: 'update-available',
          sizeBytes: totalBytes,
        };
        await db.modules.put(updated);
        result.push(updated);
        continue;
      }
      result.push(existing);
    } else {
      const initial: StoredModule = {
        id: mod.id,
        name: mod.name,
        nameBn: mod.nameBn,
        version: mod.version,
        status: 'not-installed',
        purpose: mod.purpose,
        requiredFor: mod.requiredFor,
        sizeBytes: totalBytes,
        progressPercent: 0,
      };
      await db.modules.put(initial);
      result.push(initial);
    }
  }

  return result;
}

/**
 * Returns modules required for a capability that are NOT yet installed.
 */
export async function checkMissingModules(
  requiredFor: 'video' | 'image' | 'both'
): Promise<ModuleDefinition[]> {
  const manifest = await getModulesManifest();
  const stored = await getStoredModules();
  const installedMap = new Map(
    stored.filter((s) => s.status === 'installed').map((s) => [s.id, true])
  );

  return manifest.modules.filter((m) => {
    // Check capability filter
    const matchesScope =
      requiredFor === 'both' ||
      m.requiredFor === 'both' ||
      m.requiredFor === requiredFor;

    return matchesScope && !installedMap.get(m.id);
  });
}

/**
 * Computes SHA-256 hash string in lowercase hex from ArrayBuffer.
 */
export async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads a module with progress and SHA-256 verification, and saves to Cache Storage.
 */
export async function installModule(
  moduleId: string,
  onProgress?: (percent: number, loaded: number, total: number) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  const manifest = await getModulesManifest();
  const modDef = manifest.modules.find((m) => m.id === moduleId);
  if (!modDef) {
    throw new Error(`Module "${moduleId}" not found in manifest`);
  }

  // Request persistent storage on first install
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      // ignore
    }
  }

  // Update status to downloading
  const totalModuleBytes = modDef.files.reduce((acc, f) => acc + f.sizeBytes, 0);
  await db.modules.update(moduleId, {
    status: 'downloading',
    sizeBytes: totalModuleBytes,
    downloadedBytes: 0,
    progressPercent: 0,
    errorMessage: undefined,
  });

  const cache = await caches.open(MODULES_CACHE_NAME);
  let totalDownloaded = 0;

  try {
    for (const fileItem of modDef.files) {
      if (abortSignal?.aborted) {
        throw new Error('Download aborted by user');
      }

      const fileUrl = (modDef.sourceUrl || '/') + fileItem.path;
      const response = await fetch(fileUrl, {
        signal: abortSignal,
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error(`Failed to download ${fileUrl}: ${response.statusText}`);
      }

      // Read stream with progress
      const reader = response.body?.getReader();
      if (!reader) {
        const arrayBuf = await response.arrayBuffer();
        totalDownloaded += arrayBuf.byteLength;
        onProgress?.(
          Math.round((totalDownloaded / totalModuleBytes) * 100),
          totalDownloaded,
          totalModuleBytes
        );
        await verifyAndCacheFile(cache, fileUrl, arrayBuf, fileItem.sha256, moduleId);
        continue;
      }

      const chunks: Uint8Array[] = [];
      let fileDownloaded = 0;

      while (true) {
        if (abortSignal?.aborted) {
          reader.cancel();
          throw new Error('Download aborted by user');
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        fileDownloaded += value.byteLength;
        totalDownloaded += value.byteLength;

        const percent = Math.min(
          99,
          Math.round((totalDownloaded / totalModuleBytes) * 100)
        );
        onProgress?.(percent, totalDownloaded, totalModuleBytes);

        await db.modules.update(moduleId, {
          downloadedBytes: totalDownloaded,
          progressPercent: percent,
        });
      }

      // Combine chunks into single ArrayBuffer
      const combined = new Uint8Array(fileDownloaded);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      // Verifying state
      await db.modules.update(moduleId, { status: 'verifying' });
      await verifyAndCacheFile(cache, fileUrl, combined.buffer, fileItem.sha256, moduleId);
    }

    // Successfully installed
    await db.modules.update(moduleId, {
      status: 'installed',
      progressPercent: 100,
      downloadedBytes: totalModuleBytes,
      installedAt: Date.now(),
      errorMessage: undefined,
    });
  } catch (err: any) {
    const errorMsg = err?.message || 'Download failed';
    await db.modules.update(moduleId, {
      status: 'error',
      errorMessage: errorMsg,
    });
    throw err;
  }
}

async function verifyAndCacheFile(
  cache: Cache,
  fileUrl: string,
  buffer: ArrayBuffer,
  expectedSha256: string,
  moduleId: string
): Promise<void> {
  const actualHash = await computeSha256(buffer);
  if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
    // Delete corrupt entry and throw error
    await cache.delete(fileUrl);
    throw new Error(
      `SHA-256 hash mismatch for ${fileUrl}! Expected: ${expectedSha256.slice(0, 10)}..., Got: ${actualHash.slice(0, 10)}...`
    );
  }

  // Store in cache with 200 OK Response
  const headers = new Headers({
    'Content-Type': fileUrl.endsWith('.js')
      ? 'application/javascript'
      : fileUrl.endsWith('.woff2')
      ? 'font/woff2'
      : 'application/octet-stream',
    'Content-Length': String(buffer.byteLength),
  });

  const response = new Response(buffer, { status: 200, headers });
  await cache.put(fileUrl, response);
}

/**
 * Removes module from Cache Storage and marks state as not-installed.
 */
export async function uninstallModule(moduleId: string): Promise<void> {
  const manifest = await getModulesManifest();
  const modDef = manifest.modules.find((m) => m.id === moduleId);
  if (modDef) {
    const cache = await caches.open(MODULES_CACHE_NAME);
    for (const f of modDef.files) {
      const fileUrl = (modDef.sourceUrl || '/') + f.path;
      await cache.delete(fileUrl);
    }
  }

  await db.modules.update(moduleId, {
    status: 'not-installed',
    downloadedBytes: 0,
    progressPercent: 0,
    installedAt: undefined,
    errorMessage: undefined,
  });
}

/**
 * Dynamically loads and executes a cached module bundle script in the browser window.
 */
export async function loadModuleScript(moduleId: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const manifest = await getModulesManifest();
  const modDef = manifest.modules.find((m) => m.id === moduleId);
  if (!modDef) return;

  const cache = await caches.open(MODULES_CACHE_NAME);

  for (const fileItem of modDef.files) {
    if (!fileItem.path.endsWith('.js')) continue;

    const fileUrl = (modDef.sourceUrl || '/') + fileItem.path;
    let cachedRes = await cache.match(fileUrl);
    if (!cachedRes) {
      // Fallback to fetch if not cached yet
      cachedRes = await fetch(fileUrl);
    }

    const scriptCode = await cachedRes.text();
    const scriptEl = document.createElement('script');
    scriptEl.textContent = scriptCode;
    document.head.appendChild(scriptEl);
  }
}
