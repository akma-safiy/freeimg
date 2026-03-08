import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadImageToHost } from '../src/services/imgbbApi.js';

const jsonResponse = (payload, status = 200) => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

test('uploadImageToHost sends image payload to backend and returns uploaded URL', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  let capturedUrl = '';
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return jsonResponse({ url: 'https://example.com/image.jpg' });
  };

  const result = await uploadImageToHost('data:image/png;base64,abc123');
  assert.equal(result, 'https://example.com/image.jpg');
  assert.equal(capturedUrl, '/api/freeimage/upload');
  assert.equal(capturedBody.image, 'data:image/png;base64,abc123');
});

test('uploadImageToHost surfaces backend errors', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => jsonResponse({ error: 'Bad payload' }, 400);

  await assert.rejects(
    () => uploadImageToHost('data:image/png;base64,abc123'),
    /upload failed/i
  );
});

