import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyUploadError,
  createJsonResponse,
  isAbortError,
  readJsonBody,
  uploadToFreeImage,
} from './freeimageProxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT || 8787);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

const sanitizePathname = (pathname) => {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  return normalized === path.sep ? '' : normalized;
};

const getSafeFilePath = (pathname) => {
  const relativePath = sanitizePathname(pathname).replace(/^[/\\]+/, '');
  const filePath = relativePath ? path.join(distDir, relativePath) : path.join(distDir, 'index.html');
  if (!filePath.startsWith(distDir)) return null;
  return filePath;
};

const sendFile = async (req, res, filePath) => {
  const fileStats = await stat(filePath);
  const finalPath = fileStats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
  const extension = path.extname(finalPath).toLowerCase();
  const contentType = contentTypes[extension] || 'application/octet-stream';

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise((resolve, reject) => {
    const stream = createReadStream(finalPath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
};

const handleUploadRequest = async (req, res) => {
  if (req.method !== 'POST') {
    createJsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  const apiKey = process.env.FREEIMAGE_API_KEY;
  if (!apiKey) {
    createJsonResponse(res, 500, { error: 'Server upload key is not configured.' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const image = typeof body.image === 'string' ? body.image : '';
    if (!image) {
      createJsonResponse(res, 400, { error: 'Missing required "image" field.' });
      return;
    }

    const url = await uploadToFreeImage({
      imageInput: image,
      apiKey,
    });

    createJsonResponse(res, 200, { url });
  } catch (error) {
    const statusCode = classifyUploadError(error);
    if (statusCode !== 499) {
      console.error('Upload API error:', error);
    }
    createJsonResponse(res, statusCode, { error: error?.message || 'Upload failed.' });
  }
};

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/health') {
    createJsonResponse(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/freeimage/upload') {
    await handleUploadRequest(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    createJsonResponse(res, 404, { error: 'Not found.' });
    return;
  }

  const safeFilePath = getSafeFilePath(pathname);
  if (!safeFilePath) {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }

  try {
    await sendFile(req, res, safeFilePath);
  } catch {
    try {
      await sendFile(req, res, path.join(distDir, 'index.html'));
    } catch {
      createJsonResponse(res, 404, { error: 'Build output not found. Run "npm run build" first.' });
    }
  }
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
  if (!isAbortError(error)) {
    console.error('Uncaught exception:', error);
  }
});

