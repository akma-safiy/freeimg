# Outfit AI Studio

AI-powered outfit image/video generator built with React + Vite.

## Security-first upload flow

Local image uploads are proxied through `/api/freeimage/upload` so the FreeImage API key is never shipped to the browser bundle.

- Development (`npm run dev`): Vite middleware exposes the upload endpoint.
- Production (`npm run start`): Node server (`server/index.js`) exposes the upload endpoint and serves `dist/`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment variables:

```bash
cp .env.example .env
```

3. Set `FREEIMAGE_API_KEY` in `.env`.

## Scripts

- `npm run dev`: start Vite dev server.
- `npm run build`: production build.
- `npm run start`: serve `dist/` + backend upload API on `PORT` (default `8787`).
- `npm run lint`: run ESLint.
- `npm run test`: run unit/integration tests with Node's built-in test runner.

## Quality gates

CI runs:

- Lint
- Tests
- Production build
