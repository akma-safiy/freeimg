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

    if (String(url).includes('/veo/record-info')) {
      return new Response('Not found', { status: 404 });
    }

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
  assert.equal(requestedUrls.length, 3);
  assert.match(requestedUrls[0], /\/veo\/record-info/);
  assert.match(requestedUrls[1], /\/veo\/recordInfo/);
  assert.match(requestedUrls[2], /\/jobs\/recordInfo/);
});

test('pollVideoStatus retries when API response says recordInfo is null', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  let calls = 0;
  global.fetch = async () => {
    calls += 1;

    if (calls === 1) {
      return jsonResponse({ code: 500, msg: 'recordInfo is null' });
    }

    return jsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/retried-video.mp4'] }),
      },
    });
  };

  const resultUrl = await pollVideoStatus('api-key', 'video_task_2', null, {
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    maxAttempts: 3,
  });

  assert.equal(resultUrl, 'https://example.com/retried-video.mp4');
  assert.equal(calls, 2);
});

test('pollVideoStatus retries when HTTP 500 returns recordInfo is null', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  let calls = 0;
  global.fetch = async () => {
    calls += 1;

    if (calls === 1) {
      return new Response(JSON.stringify({ code: 500, msg: 'recordInfo is null' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return jsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/http-retried-video.mp4'] }),
      },
    });
  };

  const resultUrl = await pollVideoStatus('api-key', 'video_task_3', null, {
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    maxAttempts: 3,
  });

  assert.equal(resultUrl, 'https://example.com/http-retried-video.mp4');
  assert.equal(calls, 2);
});

test('pollVideoStatus supports veo record-info successFlag schema', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse({
      code: 200,
      data: {
        successFlag: 1,
        response: {
          resultUrls: ['https://example.com/success-flag-video.mp4'],
        },
      },
    });
  };

  const resultUrl = await pollVideoStatus('api-key', 'video_task_4', null, {
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    maxAttempts: 3,
  });

  assert.equal(resultUrl, 'https://example.com/success-flag-video.mp4');
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /\/veo\/record-info/);
});

test('pollVideoStatus tries jobs endpoint when legacy payload says recordInfo is null', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const requestedUrls = [];
  global.fetch = async (url) => {
    const resolvedUrl = String(url);
    requestedUrls.push(resolvedUrl);

    if (resolvedUrl.includes('/veo/record-info')) {
      return new Response('Not found', { status: 404 });
    }

    if (resolvedUrl.includes('/veo/recordInfo')) {
      return jsonResponse({ code: 500, msg: 'recordInfo is null' });
    }

    return jsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/jobs-fallback-video.mp4'] }),
      },
    });
  };

  const resultUrl = await pollVideoStatus('api-key', 'video_task_5', null, {
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    maxAttempts: 3,
  });

  assert.equal(resultUrl, 'https://example.com/jobs-fallback-video.mp4');
  assert.equal(requestedUrls.length, 3);
  assert.match(requestedUrls[0], /\/veo\/record-info/);
  assert.match(requestedUrls[1], /\/veo\/recordInfo/);
  assert.match(requestedUrls[2], /\/jobs\/recordInfo/);
});
