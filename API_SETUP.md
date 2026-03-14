# API Setup Guide

This app uses three external services. Follow these steps to configure each one.

---

## 1. kie.ai API Key (Required)

Used for AI image generation, video generation, and GPT-5.2 image analysis.

### Get Your Key

1. Sign up at [https://kie.ai](https://kie.ai)
2. Navigate to your dashboard → **API Keys**
3. Create a new API key and copy it

### Configure in the App

The kie.ai API key is **not stored in `.env`** — it is entered directly in the app's **Settings** tab at runtime and saved to `localStorage`. This allows each user to use their own credits.

1. Open the app → click **Settings** (bottom nav)
2. Paste your API key into the "API Key" field
3. Click **Sync Token** to verify connection and see your credit balance

### Model Requirements

| Feature | Model | Notes |
|---------|-------|-------|
| Image generation | `nano-banana-2` | Included in standard kie.ai plan |
| Video generation | `veo3` / `veo3_fast` | Requires Veo 3.1 access on your account |
| Image analysis | `gpt-5-2` | Requires GPT-5.2 access on your account |

> **Note:** Veo 3.1 and GPT-5.2 may require a specific plan or add-on. Check your kie.ai account for model access.

---

## 2. Image Upload — ImgBB (Required for Netlify / Static Hosting)

Uploaded images must be hosted at a public URL before they can be sent to the kie.ai API. On static hosts like Netlify, ImgBB is used for direct browser-side upload.

### Get Your Key

1. Sign up at [https://imgbb.com](https://imgbb.com)
2. Go to [https://api.imgbb.com/](https://api.imgbb.com/) and click **Get API Key**
3. Copy the key

### Configure

Add to your deployment environment (Netlify settings or `.env` file):

```env
VITE_IMGBB_API_KEY=your_imgbb_api_key_here
```

> **Important:** The `VITE_` prefix is required for Vite to expose the variable to the browser at build time.

On Netlify:
1. Go to **Site Settings → Environment Variables**
2. Add `VITE_IMGBB_API_KEY` with your key
3. **Redeploy** the site (the key is baked in at build time)

---

## 3. FreeImage.host (Local Development Fallback)

When no ImgBB key is present, the app falls back to uploading through the local Node.js server, which proxies the upload to freeimage.host.

### Get Your Key

1. Go to [https://freeimage.host/page/api](https://freeimage.host/page/api)
2. Register or log in and copy your API key

### Configure

Add to your local `.env` file:

```env
FREEIMAGE_API_KEY=your_freeimage_key_here
```

This key is used **server-side only** (not exposed to the browser). The Vite dev server proxies `/api/freeimage/upload` requests to the local Node.js server.

> **Note:** This fallback does NOT work on Netlify or other static hosts. For production, always set `VITE_IMGBB_API_KEY`.

---

## Upload Priority

```
1. VITE_IMGBB_API_KEY set?  →  Upload directly from browser to ImgBB  ✅ Works everywhere
2. No ImgBB key             →  Proxy to local server → FreeImage.host  ⚠️ Local dev only
```

---

## Environment Variable Summary

| Variable | Where | Purpose | Required? |
|----------|-------|---------|-----------|
| `VITE_IMGBB_API_KEY` | `.env` / Netlify | Browser-side image upload to ImgBB | Yes (for prod) |
| `FREEIMAGE_API_KEY` | `.env` (server-side) | Server-proxy image upload (local dev) | Yes (for local) |
| `PORT` | Server env | Port for the Node.js production server | No (default 8787) |

---

## `.env.example`

```env
# ImgBB — for browser-side uploads (Netlify / static hosting)
VITE_IMGBB_API_KEY=your_imgbb_key_here

# FreeImage.host — for local server-proxy uploads (dev only)
FREEIMAGE_API_KEY=your_freeimage_key_here
```
