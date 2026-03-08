import assert from 'node:assert/strict';
import test from 'node:test';
import { createTask, pollTaskStatus } from '../src/services/nanoBananaApi.js';

const jsonResponse = (payload, status = 200) => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

test('createTask creates a task and returns taskId', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  let capturedUrl = '';
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return jsonResponse({ code: 200, data: { taskId: 'task_123' } });
  };

  const taskId = await createTask('api-key', 'prompt', ['https://example.com/img.jpg'], '2K', '1:1');
  assert.equal(taskId, 'task_123');
  assert.match(capturedUrl, /\/createTask$/);
  assert.equal(capturedBody.input.resolution, '2K');
});

test('pollTaskStatus resolves once task completes', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const states = ['running', 'success'];
  let index = 0;
  global.fetch = async () => {
    const state = states[index];
    index += 1;
    if (state === 'success') {
      return jsonResponse({
        code: 200,
        data: {
          state,
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/final.jpg'] }),
        },
      });
    }

    return jsonResponse({ code: 200, data: { state } });
  };

  const seenStates = [];
  const url = await pollTaskStatus('api-key', 'task_abc', (state) => {
    seenStates.push(state);
  }, {
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    maxAttempts: 5,
  });

  assert.equal(url, 'https://example.com/final.jpg');
  assert.deepEqual(seenStates, ['running', 'success']);
});

test('pollTaskStatus fails when timeout is reached', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => jsonResponse({ code: 200, data: { state: 'running' } });

  await assert.rejects(
    () => pollTaskStatus('api-key', 'task_timeout', null, {
      pollIntervalMs: 1,
      timeoutMs: 2,
      maxAttempts: 2,
    }),
    /timed out/i
  );
});

