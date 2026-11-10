# Motion Studio

Motion Studio is a privacy-first, chat-first AI application built with Next.js 15 App Router, Tailwind CSS, and Bring Your Own Key (BYOK) Google Gemini access. It features automated key rotation, per-model cooldown handling, AES-GCM WebCrypto encrypted local storage in IndexedDB, and first-class English and Bengali (Unicode) rendering.

## Architecture & Principles

1. **Next.js with Secure API Routes**: Requests pass through secure Next.js API endpoints (`/api/gemini/stream`, `/api/gemini/models`, `/api/gemini/live`) which communicate with Google Gemini using the `@google/genai` SDK.
2. **Bring Your Own Key (BYOK) — Zero Server Key Fallback**: There is no server-side `GEMINI_API_KEY`. Each user supplies their own Gemini API keys. Keys are decrypted on demand in the browser and passed to the API routes via the `x-goog-api-key` header.
3. **Encrypted Key Vault**: API keys are encrypted with WebCrypto AES-GCM (256-bit) before entering IndexedDB. A non-extractable CryptoKey is stored locally by default, with an optional PBKDF2-derived passphrase layer (100,000 iterations) for offline backup protection.
4. **Per-Model Cooldown & Auto Fallback**: Gemini quotas and rate limits are model-specific. A 429 rate limit on a specific model only puts that key + model into a temporary cooldown (using the `retryDelay` specified by Google). Keys remain healthy and active for other models.
5. **Auto (Best Model) Routing**: In Auto mode, the app ranks available chat models (stable Flash first, then Pro, then Flash-Lite, then Preview models). If all keys are cooling down on the top model, it automatically falls back to the next best model (up to 5 candidates).
6. **Live Key Health Checker**: Keys are validated automatically upon saving by querying the live model list from Google (no generation quota used). Settings displays live latency, time since last check, number of models, and cooldown countdowns.
7. **Premium Responsive UI**: Model picker renders as a popover on desktop and an iOS-style bottom sheet on mobile. Settings provides a structured left-navigation layout on desktop and individual sub-screens on mobile. Restrained design tokens: Graphite (`#0F1115`), Slate (`#181B21`), Fog (`#E9EBEF`), and Vermilion (`#FF5B3A`).

---

## How to Run Locally

### Prerequisites
- Node.js 20+ or 22+
- npm 9+

### Steps
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the local development server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000` in your web browser.

---

## Production Build

To test and compile a production build:
```bash
npm run build
```

---

## Push 2: Video & Image Synthesis Engine

Push 2 introduces deterministic client-side animation and video rendering, real device capability measurement, offline module install management, and high-resolution image creation.

### 1. Real Device Capability Detection (`Settings > Device check`)
Measures actual hardware and browser support without mock or simulated data:
- **WebCodecs VideoEncoder (H.264)**: Tested via `VideoEncoder.isConfigSupported` at 720p (AVC1.4D001F) and 1080p (AVC1.4D0028) at 30 fps.
- **OffscreenCanvas & Dedicated Web Workers**: Verifies background thread synthesis.
- **Cache Storage & OPFS (`navigator.storage.getDirectory`)**: Verifies offline local bundle storage.
- **MediaRecorder Fallback**: Tests `canvas.captureStream` and selects the best supported format (`video/mp4`, `video/webm;codecs=vp9`, `video/webm`).
- **Storage Quota & Persistence**: Measures used space and free space via `navigator.storage.estimate()` and persistence status via `navigator.storage.persisted()`.
- **Render Path Selection**: Selects **Path A (WebCodecs H.264 MP4)** on supported devices, or **Path B (MediaRecorder Canvas Stream)** as a fallback.

### 2. Module Install Manager & Measured Bundle Sizes
Heavy runtime libraries are bundled into `/public/modules/`, downloaded once, verified by SHA-256 hash, and stored in Cache Storage (`motion-studio-modules-v1`):

| Module ID | Bundle File | Measured Size | SHA-256 Checksum | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `render-core` | `modules/render-core.bundle.js` | **74,398 bytes** (72.7 KB) | `206b654c03f0b8ad90f54a15395c0996177ecfc87845a6692a70ab4ab2e5e357` | WebCodecs VideoEncoder & MP4-Muxer container synthesis |
| `scene-engine` | `modules/scene-engine.bundle.js` | **5,200 bytes** (5.1 KB) | `6fb7c51d405c731fc4fc205902e5b45df1798f2f5a71d957d784b318c960707c` | Pure deterministic 2D canvas animation renderer & easing engine |
| `fonts` | `modules/fonts.bundle.js` | **1,114 bytes** (1.1 KB) | `2c0db788ce31b0b6f9a91827e581e3be174dc91e7997e9e9c2b7e76b26f58b7c` | Pre-caches offline Bengali (Hind Siliguri) & English (Geist) WebFonts |
| **Total** | | **80,712 bytes** (~78.8 KB) | | **Ultra-lightweight total client footprint** |

- **Storage Rationale**: Cache Storage (`caches.open`) was selected over OPFS because it provides direct, seamless HTTP-style access in both the Window context and dedicated Web Worker threads, preventing serialization bottlenecks and cross-context permission issues.
- **Integrity**: Every downloaded byte array is hashed with `crypto.subtle.digest('SHA-256')`. Any mismatch deletes the entry and displays a clear error.
- **One-Time Consent Sheet**: If any required module is missing when rendering, a consent modal appears showing exact file sizes, total download, and free device storage. Once installed, it never prompts again.

### 3. Deterministic Scene Engine
- Pure `renderScene(scene, t, ctx)` drawing to 2D canvas. Zero non-deterministic calls (`Date.now()` and `Math.random()` are strictly forbidden).
- Keyframe property interpolation with `linear`, `ease-in`, `ease-out`, `ease-in-out`, `back` (overshoot), and damped `spring` easing.
- Text layer supports Bengali and English typography with letter, word, or line stagger reveal animation.
- Schema validator (`validateScene`) checks canvas configuration, track hierarchy, and keyframe timings.
- 3 built-in production templates:
  1. **Animated Title Card** (Bengali & English typography, backdrop card, accent line, pro pill).
  2. **Lower-Third Name Tag** (Broadcast standard presenter card with slide-in spring animation).
  3. **Logo Reveal / Emblem** (Square 1:1 format, rotating geometric diamond with concentric expanding rings).

### 4. Video Lab (Preview & Render)
- Interactive canvas player with scrub timeline (0 to duration), play/pause, loop toggle, and speed selector (0.5x, 1x, 2x).
- Live reactive JSON schema editor with instant error feedback.
- Hardware-accelerated rendering:
  - **Path A**: WebCodecs `VideoEncoder` with AVC1 H.264 at 30fps + `mp4-muxer` in Web Worker/OffscreenCanvas.
  - **Path B**: `MediaRecorder` with `canvas.captureStream`.
- Real-time progress bar: frame counter, percentage, encoding FPS, elapsed time, and estimated time remaining.
- Memory cleanup: closes encoders, flushes chunk queues, revokes object URLs, and supports instant cancellation.
- Saves rendered MP4 files and stills directly to Dexie `files` table and disk.

### 5. Image Lab
- **Path 1 (Scene Frame Exporter)**: Pristine PNG still export at current scrub time with aspect ratios: `1:1 (Square - 1080x1080)`, `4:5 (Portrait - 1080x1350)`, `9:16 (Story/Reel - 1080x1920)`, and `16:9 (Landscape - 1920x1080)`.
- **Path 2 (Gemini Image Generation)**: Secure server route `/api/gemini/images` with user BYOK authentication via `x-goog-api-key`, dynamic model detection, aspect ratio selection (`1:1`, `3:4`, `4:3`, `9:16`, `16:9`), and clear failure explanations if the user's key lacks Imagen quota.

---

## Production Build & Verification

To compile and verify the applet:
```bash
npm run build
```

To run all automated unit tests (24/24 passing):
```bash
npm test
```

