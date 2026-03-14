# Changelog

All notable changes to **Mejin AI Image & Video Generation Studio** are documented here.

---

## [Unreleased] — 2026-03-14

### Changed — UI Redesign (Premium AI Studio Aesthetic)

A complete UI overhaul inspired by Higgsfield, Runway, and Midjourney Web.

#### Header
- Mode toggle simplified to **Image** / **Video** labels only (removed icons and extra wording)

#### Generation Panel
- Replaced separate Upload Card + Prompt Card with a **unified gen-panel**:
  - Drag-and-drop drop zone with dashed border, file count badge (`X / 14`)
  - Click-to-browse, Ctrl+V paste, drag-drop, and URL paste — all in one zone
  - 4-column thumbnail grid with hover-reveal remove button
  - URL input row inside panel
- Added **GPT-5.2 Image Analysis** row with inline Analyze button
- Added **Proceed button** inline in the prompt card (replaced the standalone "Imagine Now" button)

#### Controls Panel
- New separate `.gen-controls-panel` card below the gen-panel with:
  - **Output Variations**: renamed from "2 Layouts / 4 Layouts" → **"2 Variations / 4 Variations"**
  - **Resolution**: 1K / 2K / 4K pill chips
  - **Aspect Ratio**: Auto / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 pill chips

#### Video Panel
- Separate `.gen-panel` for video mode with Generation Type, Scene Prompt, Veo Model, and Format chips
- Inline **Proceed** button for video generation

#### Removed
- Hero section (AI-Powered Generation badge + heading + subtitle) — removed to reduce vertical friction
- Standalone "Imagine Now" / "Animate Now" button

#### Design Tokens
- Background palette updated to richer dark values:
  - `--bg-base: #0f1115`
  - `--bg-surface: #14171c`
  - `--bg-elevated: #1b1f26`
- `.mejin-chip` updated to use flexbox centering (`display: flex; align-items: center; justify-content: center`)
- Stronger active chip glow added to `--active` state

#### New CSS Classes
- `.gen-panel` — unified glass-style card
- `.upload-drop-zone` — dashed border drop target with drag-active state
- `.gen-controls-panel` — controls card
- `.prompt-proceed-btn` — inline blue generate button with glow and press animation

---

## Earlier Changes

### Video Generation
- Added **Veo 3.1** support via kie.ai API (text-to-video, image-to-video, reference-to-video)
- Added "Import Preferred to Veo" button to carry selected image into video mode

### Image Generation
- Added multi-output (2 or 4 variations) support with cost breakdown per variation
- Added generation history with thumbnails, prompt text, and cost badge
- Added "Regenerate from Variant" — click any history thumbnail to reload it as the base image

### API & Upload
- Added ImgBB direct browser upload path (`VITE_IMGBB_API_KEY`)
- Added FreeImage.host server proxy fallback (`FREEIMAGE_API_KEY`)
- Added `/health` endpoint to the Node.js server
- Fixed Netlify deployment: static-host-aware error messages guide users to set correct env vars

### Settings
- Added API key entry with "Sync Token" connection test
- Added live credit balance display with manual refresh

### Project
- Project renamed from `ai-outfit-generator` to `mejin-apps`
- Updated `package.json`, helper scripts (`move_results.js`, `move_results.cjs`, `move_results.py`) with new name

---

## Format

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions.

Types of changes: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
