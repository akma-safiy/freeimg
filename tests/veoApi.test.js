import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoTask, pollVideoStatus } from '../src/services/veoApi.js';

const jsonResponse = (payload, status = 200) => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

test('createVideoTask validates aspect ratio', async () => {
  await assert.rejects(
    () => createVideoTask(
      'api-key',
      'prompt',
      ['https://example.com/first.jpg'],
      'FIRST_AND_LAST_FRAMES_2_VIDEO',
      'veo3_fast',
      'auto'
    ),
    /invalid video aspect ratio/i
  );
});

test('pollVideoStatus falls back to jobs endpoint when veo record endpoint is missing', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(String(url));

    if (String(url).includes('/veo/recordInfo')) {
      return new Response('Not found', { status: 404 });
    }

    return jsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/final-video.mp4'] }),
      },
    });
  };

  const resultUrl = await pollVideoStatus('api-key', 'video_task_1', null, {
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    maxAttempts: 3,
  });

  assert.equal(resultUrl, 'https://example.com/final-video.mp4');
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /\/veo\/recordInfo/);
  assert.match(requestedUrls[1], /\/jobs\/recordInfo/);
});

