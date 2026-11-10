export type KeyHealthStatus = 'healthy' | 'checking' | 'limited' | 'invalid' | 'offline' | 'error';
export type KeyState = 'active' | 'rate-limited' | 'invalid' | 'error' | 'checking';

export type ModelCategory = 'chat' | 'image' | 'live' | 'audio' | 'other';

export interface KeyModelInfo {
  id: string;          // e.g. "gemini-2.5-flash"
  rawName: string;     // e.g. "models/gemini-2.5-flash"
  displayName: string; // e.g. "Gemini 2.5 Flash"
  description?: string;
  category: ModelCategory;
  supportedActions: string[];
  isFast?: boolean;
  isLite?: boolean;
  isPro?: boolean;
  isPreview?: boolean;
}

export interface StoredKey {
  id: string;
  label: string;
  encryptedKey: string; // Base64
  iv: string;           // Base64
  last4: string;        // E.g. "4b9a"
  state: KeyState;
  healthStatus?: KeyHealthStatus;
  cooldownUntil: number | null; // Legacy / general cooldown timestamp in ms
  modelCooldowns?: Record<string, number>; // { [modelId]: untilTimestampMs }
  models?: KeyModelInfo[]; // dynamically fetched from Google for this key
  lastChecked?: number; // timestamp in ms
  responseTimeMs?: number; // latency in ms
  lastUsed?: number;
  requestCount?: number;
  errorMessage?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'model';
  content: string;
  createdAt: number;
  keyLabel?: string;
  modelName?: string;
  modelDisplayName?: string;
  error?: string;
}

export interface SettingItem {
  key: string;
  value: any;
}

export interface GeminiModelInfo {
  name: string;
  displayName: string;
  description?: string;
  supportedGenerationMethods?: string[];
  category?: ModelCategory;
}

export type GeminiErrorCode =
  | 'no_key'
  | 'invalid_key'
  | 'rate_limit'
  | 'model_unavailable'
  | 'overloaded'
  | 'bad_request'
  | 'network'
  | 'unknown';

export interface ClassifiedError {
  error: string;
  code: GeminiErrorCode;
  retryAfterSec?: number;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// Push 2: Device Check Types
// ---------------------------------------------------------------------------

export type SupportStatus = 'supported' | 'not-supported' | 'unknown';

export interface FeatureCheckItem {
  name: string;
  status: SupportStatus;
  details?: string;
}

export interface StorageEstimateInfo {
  quotaBytes?: number;
  usageBytes?: number;
  freeBytes?: number;
  persisted?: boolean;
}

export interface DeviceCheckResult {
  webCodecsH264_720p: SupportStatus;
  webCodecsH264_1080p: SupportStatus;
  offscreenCanvas: SupportStatus;
  webWorkers: SupportStatus;
  cacheStorage: SupportStatus;
  opfs: SupportStatus;
  indexedDB: SupportStatus;
  mediaRecorderFallback: SupportStatus;
  mediaRecorderMimeType?: string;
  storage: StorageEstimateInfo;
  recommendedRenderPath: 'webcodecs-h264' | 'mediarecorder-fallback' | 'unsupported';
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// Push 2: Module Install Manager Types
// ---------------------------------------------------------------------------

export type ModuleStatus =
  | 'not-installed'
  | 'downloading'
  | 'verifying'
  | 'installed'
  | 'update-available'
  | 'error';

export interface ModuleFileItem {
  path: string;       // relative path e.g. "render-core.bundle.js"
  sizeBytes: number;  // exact byte size
  sha256: string;     // SHA-256 hash in lowercase hex
}

export interface ModuleDefinition {
  id: string; // 'render-core' | 'fonts' | 'scene-engine'
  name: string;
  nameBn: string;
  version: string;
  purpose: string;
  purposeBn?: string;
  requiredFor: 'video' | 'image' | 'both';
  files: ModuleFileItem[];
  sourceUrl?: string; // default '/modules/'
}

export interface ModulesManifest {
  schemaVersion: number;
  updatedAt: string;
  modules: ModuleDefinition[];
}

export interface StoredModule {
  id: string;
  name: string;
  nameBn?: string;
  version: string;
  status: ModuleStatus;
  purpose: string;
  requiredFor: 'video' | 'image' | 'both';
  sizeBytes: number;
  downloadedBytes?: number;
  progressPercent?: number;
  installedAt?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Push 2: Scene Engine & Animation Schema Types
// ---------------------------------------------------------------------------

export type EasingType =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'back'
  | 'spring';

export interface Keyframe {
  time: number; // in seconds
  property: string; // 'x' | 'y' | 'opacity' | 'scaleX' | 'scaleY' | 'rotation' | 'color' | etc.
  value: number | string;
  easing?: EasingType;
}

export type LayerType =
  | 'text'
  | 'rect'
  | 'rounded-rect'
  | 'circle'
  | 'line'
  | 'image'
  | 'group';

export interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  x?: number;
  y?: number;
  anchorX?: number; // 0 (left), 0.5 (center), 1 (right)
  anchorY?: number; // 0 (top), 0.5 (middle), 1 (bottom)
  rotation?: number; // degrees
  scaleX?: number;
  scaleY?: number;
  opacity?: number; // 0 to 1
  color?: string;
  keyframes?: Keyframe[];
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;
  lineHeight?: number;
  stagger?: {
    mode: 'letter' | 'word' | 'line';
    duration: number; // total stagger reveal duration in seconds
    startTime?: number; // delay start time
  };
}

export interface RectLayer extends BaseLayer {
  type: 'rect';
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface RoundedRectLayer extends BaseLayer {
  type: 'rounded-rect';
  width: number;
  height: number;
  radius: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface CircleLayer extends BaseLayer {
  type: 'circle';
  radius: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface LineLayer extends BaseLayer {
  type: 'line';
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  lineCap?: 'butt' | 'round' | 'square';
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string; // URL or data URL
  width: number;
  height: number;
  fit?: 'contain' | 'cover' | 'fill';
}

export interface GroupLayer extends BaseLayer {
  type: 'group';
  children: SceneLayer[];
}

export type SceneLayer =
  | TextLayer
  | RectLayer
  | RoundedRectLayer
  | CircleLayer
  | LineLayer
  | ImageLayer
  | GroupLayer;

export interface SceneCanvasConfig {
  width: number;
  height: number;
  fps: number;
  duration: number; // in seconds
  background: string; // hex or rgb color
}

export interface Scene {
  id?: string;
  name?: string;
  canvas: SceneCanvasConfig;
  tracks: SceneLayer[];
}

// ---------------------------------------------------------------------------
// Push 2: Stored File Type
// ---------------------------------------------------------------------------

export interface StoredFile {
  id: string;
  name: string;
  type: 'video/mp4' | 'video/webm' | 'image/png';
  size: number;
  createdAt: number;
  blob?: Blob;
  sceneJson?: any;
  duration?: number;
  width?: number;
  height?: number;
  prompt?: string;
}
