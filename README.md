# Mejin — AI Image & Video Generation Studio

A premium, dark-theme AI creative studio for generating images and videos using the kie.ai API. Built with React 18 + Vite and designed for both local development and static hosting (Netlify).

---

## Features

- **AI Image Generation** — Generate high-quality images from text prompts and reference photos using the `nano-banana-2` model (kie.ai)
- **AI Video Generation** — Generate videos via Veo 3 / Veo 3 Fast with three modes:
  - **Text to Video** — prompt only
  - **Frames to Video** — 1–2 images as start/end frames
  - **Reference to Video** — 1–3 reference images (fast model only)
- **GPT-5.2 Image Analysis** — Analyze uploaded images to auto-generate high-quality prompts and 4 variation ideas
- **Drag & Drop Upload** — Upload images by drag-drop, file picker, paste (Ctrl+V), or URL
- **Multi-image Support** — Up to 14 reference images per generation
- **Output Variations** — Generate 2 or 4 image variations per prompt
- **Resolution Control** — 1K, 2K, or 4K output
- **Aspect Ratio Control** — Auto, 1:1, 4:3, 3:4, 16:9, 9:16
- **Generation History** — Local history of all generations with costs and thumbnails
- **API Credit Display** — Live credit balance display with manual refresh
- **Netlify-ready** — Deploys as a static site with browser-side image upload via ImgBB

---

## Quick Start

### Prerequisites

- Node.js 18+
- A [kie.ai](https://kie.ai) API key
- An [ImgBB](https://api.imgbb.com/) API key (for static hosting) **or** a FreeImage.host API key (for local dev)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required: kie.ai API key (stored client-side via Settings panel)
# This is entered in the UI Settings panel, not stored in .env by default

# Required for image uploads (local dev fallback)
FREEIMAGE_API_KEY=your_freeimage_host_api_key

# Required for image uploads (static hosting / Netlify)
VITE_IMGBB_API_KEY=your_imgbb_api_key
```

> See [API_SETUP.md](./API_SETUP.md) for full setup instructions.

### 3. Run Development Server

```bash
npm run dev
```

The app opens at `http://localhost:5173`.

### 4. Enter Your API Key

Go to the **Settings** tab in the app and paste your kie.ai API key. Click **Sync Token** to verify.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (frontend only) |
| `npm run dev:server` | Start the production Node.js server locally |
| `npm run build` | Build static frontend to `dist/` |
| `npm run preview` | Preview the built bundle |
| `npm run start` | Start the production server (for self-hosting) |
| `npm run lint` | Run ESLint |
| `npm test` | Run automated tests |

---

## Deployment

### Netlify (Recommended — Static Hosting)

1. Run `npm run build`
2. Deploy `dist/` to Netlify
3. In Netlify environment settings, add:
   - `VITE_IMGBB_API_KEY` = your ImgBB API key

The app uses direct browser-side uploads to ImgBB when this key is present. No server required.

### Self-Hosted (Node.js)

1. Run `npm run build`
2. Set `FREEIMAGE_API_KEY` and `PORT` environment variables
3. Run `npm run start`

The Node.js server serves the `dist/` bundle and proxies image uploads to freeimage.host.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18 |
| Build tool | Vite 5 |
| Styling | Vanilla CSS with custom design tokens |
| Icons | lucide-react |
| AI Images | kie.ai `nano-banana-2` model |
| AI Videos | kie.ai Veo 3 / Veo 3 Fast |
| AI Prompts | kie.ai GPT-5.2 |
| Image upload (prod) | ImgBB (CORS-safe, browser-direct) |
| Image upload (dev) | freeimage.host via local proxy |
| Server | Node.js HTTP (no framework) |

---

## Project Structure

```
mejin-apps/
├── src/
│   ├── App.jsx              # Main UI component, all state + handlers
│   ├── index.css            # Design system: tokens, components, utilities
│   ├── main.jsx             # React root
│   └── services/
│       ├── nanoBananaApi.js  # Image generation (create task + poll)
│       ├── veoApi.js         # Video generation (create task + poll)
│       ├── gpt5Api.js        # GPT-5.2 image analysis + prompt generation
│       └── imgbbApi.js       # Image upload (ImgBB direct + proxy fallback)
├── server/
│   ├── index.js             # Node.js HTTP server (static files + upload proxy)
│   └── freeimageProxy.js    # FreeImage.host upload logic + error handling
├── tests/                   # Automated test suite
├── .env.example             # Environment variable template
├── netlify.toml             # Netlify deployment config
├── vite.config.js           # Vite config with /api/* proxy
└── package.json
```

---

## License

Private project — all rights reserved.
