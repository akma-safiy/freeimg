# Architecture Overview

This document describes how the Mejin AI Image & Video Generation Studio is structured, how data flows, and how each layer is responsible.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Browser (React App)                │
│                                                     │
│   App.jsx  ←→  services/nanoBananaApi.js            │
│            ←→  services/veoApi.js                   │
│            ←→  services/gpt5Api.js                  │
│            ←→  services/imgbbApi.js                 │
│                     │                               │
│                     │  (upload fallback)            │
└─────────────────────┼───────────────────────────────┘
                      │
          ┌───────────▼───────────┐
          │  Node.js HTTP Server  │  (local dev / self-hosted)
          │   server/index.js     │
          │   freeimageProxy.js   │
          └───────────┬───────────┘
                      │
          ┌───────────▼──────────────────────────┐
          │         External APIs                │
          │                                      │
          │  kie.ai  — image gen, video gen,     │
          │            GPT-5.2 analysis          │
          │                                      │
          │  ImgBB   — browser-side image upload │
          │  FreeImage.host — server-side upload │
          └──────────────────────────────────────┘
```

---

## Frontend — `src/`

### `App.jsx`

The single main component. Contains all application state, UI rendering, and event handlers. Key responsibilities:

- **State management** — All state is local (`useState`): images, prompts, results, history, settings, UI modes
- **Image generation flow** — `handleGenerate()` → uploads images → creates task via `nanoBananaApi` → polls status → updates results
- **Video generation flow** — `handleVideoGenerate()` → uploads images → creates video task via `veoApi` → polls status → sets video result
- **GPT analysis flow** — `handleAnalyzePrompt()` → uploads images → calls `gpt5Api` → auto-fills prompt
- **Generation history** — Persisted to `localStorage` as JSON
- **API key + settings** — Persisted to `localStorage`; verified against kie.ai credits endpoint on sync

Key state variables:

| State | Type | Purpose |
|-------|------|---------|
| `activeTab` | `'image' \| 'video'` | Current generation mode |
| `mainTab` | `'home' \| 'history' \| 'settings'` | Navigation tab |
| `images` | `Array<{id, url, source}>` | Uploaded reference images |
| `prompt` | `string` | Image generation prompt |
| `videoPrompt` | `string` | Video generation prompt |
| `numOutputs` | `2 \| 4` | Number of image variations |
| `resolution` | `'1K' \| '2K' \| '4K'` | Output resolution |
| `aspectRatio` | `string` | Image aspect ratio |
| `resultImages` | `Array` | Current image generation results |
| `videoResultUrl` | `string \| null` | Current video result URL |
| `generationHistory` | `Array` | All past generations |
| `isGenerating` | `boolean` | Image generation in progress |
| `isVideoGenerating` | `boolean` | Video generation in progress |
| `apiKey` | `string` | kie.ai API key (from localStorage) |

---

### `src/services/`

All API communication is isolated in service modules. Each service is a plain JS module with named exports only — no classes, no singletons.

#### `nanoBananaApi.js` — Image Generation

Communicates with `https://api.kie.ai/api/v1/jobs`.

| Export | Description |
|--------|-------------|
| `createTask(apiKey, prompt, imageUrls, resolution, aspectRatio, options)` | POSTs to `/createTask`, resolves with `taskId` |
| `pollTaskStatus(apiKey, taskId, onProgress, options)` | Polls `/recordInfo?taskId=...` every 5s (timeout: 8 min) until success/fail |
| `checkConnection(apiKey, options)` | GETs `/api/v1/chat/credit`, returns credit balance |

**Task lifecycle:**
```
createTask() → taskId → pollTaskStatus() → { state: 'success', resultUrl }
```

**Defaults:**
- Poll interval: 5 000 ms
- Poll timeout: 8 min
- Request timeout: 60 s

---

#### `veoApi.js` — Video Generation

Communicates with `https://api.kie.ai/api/v1/veo`.

| Export | Description |
|--------|-------------|
| `createVideoTask(apiKey, prompt, imageUrls, generationType, model, aspectRatio, options)` | POSTs to `/veo/generate`, resolves with `taskId` |
| `pollVideoStatus(apiKey, taskId, onProgress, options)` | Polls multiple status endpoints (failover strategy) every 10s, timeout 15 min |

**Generation types:**

| UI Label | API value | Images required |
|----------|-----------|-----------------|
| Text to Video | `TEXT_2_VIDEO` | 0 |
| Frames to Video | `FIRST_AND_LAST_FRAMES_2_VIDEO` | 1–2 |
| Reference to Video | `REFERENCE_2_VIDEO` | 1–3 (veo3_fast only) |

**Status endpoint failover:** The poller tries 3 different endpoint paths in order (`/veo/record-info`, `/veo/recordInfo`, `/jobs/recordInfo`) to handle API inconsistencies.

**Defaults:**
- Poll interval: 10 000 ms
- Poll timeout: 15 min
- Request timeout: 60 s

---

#### `gpt5Api.js` — Image Analysis + Prompt Generation

Communicates with `https://api.kie.ai/gpt-5-2/v1/chat/completions`.

| Export | Description |
|--------|-------------|
| `generatePromptsWithGpt52(apiKey, imageUrls, options)` | Analyzes images, returns `{ basePrompt, variations: string[] }` |

The model is prompted to return a structured JSON object. The service strips Markdown code fences if present and parses the JSON.

**System prompt summary:** Identify core similarities across images (outfit, style, person features), generate a high-quality commercial/editorial base prompt, and produce exactly 4 variation prompts.

**Defaults:**
- Request timeout: 45 s (GPT-5.2 reasoning can be slow)

---

#### `imgbbApi.js` — Image Upload

Handles uploading local images to a public host so image URLs can be passed to kie.ai.

| Export | Description |
|--------|-------------|
| `uploadImageToHost(imageData, options)` | Uploads base64/data URI. Uses ImgBB if key is available, else proxies to local server |

**Upload strategy:**
1. If `VITE_IMGBB_API_KEY` is set → POST to `https://api.imgbb.com/1/upload` (CORS-safe, browser-direct)
2. Otherwise → POST to `/api/freeimage/upload` (Vite dev proxy → local Node.js server → freeimage.host)

---

### `src/index.css` — Design System

Vanilla CSS with CSS custom properties (design tokens). No Tailwind at runtime; Tailwind v4 is listed as a dependency but the primary styling is done via the custom token system.

**Key token groups:**

| Group | Variables |
|-------|-----------|
| Background | `--bg-base`, `--bg-surface`, `--bg-elevated` |
| Text | `--text`, `--text-secondary`, `--text-muted` |
| Brand | `--primary`, `--primary-hover`, `--primary-soft` |
| Status | `--success`, `--danger`, `--warning` |
| Borders/Shadows | `--border`, `--shadow-xs`, `--shadow-sm` |

**Key component classes:**

| Class | Purpose |
|-------|---------|
| `.gen-panel` | Unified generation card (glass style, rounded) |
| `.gen-controls-panel` | Controls card (variations, resolution, aspect ratio) |
| `.upload-drop-zone` | Dashed drop target with drag-active state |
| `.prompt-proceed-btn` | Inline blue proceed/generate button |
| `.mejin-chip` | Pill selector button |
| `.mejin-chip--active` | Active pill state (blue, glow) |
| `.mejin-btn-primary` | Primary action button |
| `.mejin-btn-secondary` | Secondary/outline button |
| `.mejin-textarea` | Styled textarea |
| `.mejin-alert--info/error` | Alert banners |

---

## Backend — `server/`

The Node.js server is a minimal HTTP server (no framework). It serves two purposes:

### 1. Static File Server

Serves the `dist/` build output. Falls back to `index.html` for unknown routes (SPA routing).

### 2. Upload Proxy — `POST /api/freeimage/upload`

During local development, the browser cannot call freeimage.host directly (CORS). This endpoint:

1. Reads the JSON body `{ image: "<base64>" }`
2. Validates and extracts the base64 payload (`freeimageProxy.js`)
3. POSTs to freeimage.host API with the server-side `FREEIMAGE_API_KEY`
4. Returns `{ url: "https://..." }` to the browser

**Other endpoints:**

| Route | Method | Description |
|-------|--------|-------------|
| `GET /health` | GET | Health check — returns `{ ok: true }` |
| `GET /api/freeimage/upload` | GET | Method Not Allowed (405) |
| `GET /*` | GET | Static files or index.html fallback |

---

## Data Flow — Image Generation

```
User clicks Proceed
        │
        ▼
Handle local files → canvas.toDataURL() → base64
        │
        ▼
uploadImageToHost() per file
  → ImgBB (if VITE_IMGBB_API_KEY) OR
  → /api/freeimage/upload proxy
        │
        ▼
Public image URLs
        │
        ▼
nanoBananaApi.createTask(apiKey, prompt, imageUrls[], resolution, aspectRatio)
  → POST https://api.kie.ai/api/v1/jobs/createTask
  ← { taskId }
        │
        ▼
nanoBananaApi.pollTaskStatus(apiKey, taskId, onProgress)
  → GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...
  (every 5s, up to 8 min)
        │
        ▼
{ state: 'success', resultUrl }
        │
        ▼
UI updates: resultImages, generationHistory
```

---

## Data Flow — Video Generation

Similar to image generation but uses `veoApi` and polls with failover across three endpoints. Video results are `<video>` elements; the app does not re-upload video files.

---

## Local Storage Schema

| Key | Content |
|-----|---------|
| `mejin_api_key` | kie.ai API key string |
| `mejin_generation_history` | JSON array of history entries |
| `mejin_num_outputs` | `2` or `4` |
| `mejin_resolution` | `'1K'`, `'2K'`, or `'4K'` |
| `mejin_aspect_ratio` | Aspect ratio string |
| `mejin_video_model` | `'veo3'` or `'veo3_fast'` |
| `mejin_video_aspect_ratio` | `'16:9'`, `'9:16'`, or `'Auto'` |
| `mejin_video_generation_type` | Generation type string |

---

## AbortController Pattern

All long-running operations (uploads, API calls, polling loops) accept an optional `signal: AbortSignal`. When the user cancels a generation:

1. `App.jsx` calls `abortControllerRef.current.abort()`
2. The signal propagates to `requestJson()` inside service modules
3. `fetch()` is cancelled, sleep intervals are rejected immediately
4. Error message `'Generation cancelled by user.'` surfaces in the UI

---

## Error Handling

All service functions throw `Error` objects with human-readable messages. `App.jsx` catches these and sets the `error` state, which renders an `mejin-alert--error` banner.

Upload errors from the proxy are classified into HTTP status codes by `classifyUploadError()`:

| Condition | Status |
|-----------|--------|
| Body too large | 413 |
| Invalid/missing payload | 400 |
| AbortError | 499 |
| Upstream API failure | 502 |
| Other | 500 |
