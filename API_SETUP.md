# API Setup Guide

## Required: Image Upload Service

The app needs a free image hosting key to upload your local images before sending them to the AI.

### Option 1: FreeImage.host (recommended)

1. Go to [https://freeimage.host](https://freeimage.host) and register a free account
2. Get your API key from your account settings
3. Create a file named `.env` in the project root with:

```
FREEIMAGE_API_KEY=your_key_here
```

4. Restart `npm run dev`

### Option 2: ImgBB (alternative)

1. Go to [https://imgbb.com/](https://imgbb.com/) and create a free account
2. Get your API key from [https://api.imgbb.com/](https://api.imgbb.com/)
3. Create `.env` in the project root:

```
VITE_IMGBB_API_KEY=your_imgbb_key_here
```

4. Restart `npm run dev`

---

Your **kie.ai API key** is set directly in the app's Settings tab and stored in browser localStorage. No `.env` entry is needed for it.
