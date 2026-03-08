import assert from 'node:assert/strict';
import test from 'node:test';
import { createTask, pollTaskStatus } from '../src/services/nanoBananaApi.js';

const jsonResponse = (payload, status = 200) => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

test('happy path: create image task then poll until completed', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const requests = [];
  global.fetch = async (url) => {
    const resolvedUrl = String(url);
    requests.push(resolvedUrl);

    if (resolvedUrl.endsWith('/createTask')) {
      return jsonResponse({ code: 200, data: { taskId: 'task_happy_path' } });
    }

    if (resolvedUrl.includes('/recordInfo')) {
      return jsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/happy-path.jpg'] }),
        },
      });
    }

    return jsonResponse({ code: 500, msg: 'Unexpected route' }, 500);
  };

  const taskId = await createTask('api-key', 'A stylish prompt', ['https://example.com/base.jpg']);
  const imageUrl = await pollTaskStatus('api-key', taskId, null, {
    pollIntervalMs: 1,
    timeoutMs: 500,
    maxAttempts: 2,
  });

  assert.equal(taskId, 'task_happy_path');
  assert.equal(imageUrl, 'https://example.com/happy-path.jpg');
  assert.equal(requests.length, 2);
});

