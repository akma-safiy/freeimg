/**
 * Service to interact with the Nano Banana 2 API from kie.ai
 */

const API_BASE_URL = 'https://api.kie.ai/api/v1/jobs';
const CREDIT_URL = 'https://api.kie.ai/api/v1/chat/credit';
const MODEL_NAME = 'nano-banana-2';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 8 * 60_000;

const isAbortError = (error) => {
  if (!error) return false;
  return error.name === 'AbortError' || /aborted|cancelled/i.test(error.message ?? '');
};

const assertApiKey = (apiKey) => {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing API key.');
  }
};

/**
 * Strips the literal string "null" that kie.ai sometimes sends as `msg`
 * when there is no specific message, so the `|| fallback` logic works.
 */
const sanitizeApiMessage = (msg) => {
  if (typeof msg !== 'string') return null;
  const trimmed = msg.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
};

const readErrorText = async (response) => {
  try {
    const text = await response.text();
    return text || 'No additional details.';
  } catch {
    return 'No additional details.';
  }
};

const sleep = (ms, signal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Generation cancelled by user.'));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Generation cancelled by user.'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const requestJson = async (url, apiKey, options = {}) => {
  assertApiKey(apiKey);

  const {
    signal,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    headers: requestHeaders,
    ...fetchOptions
  } = options;

  if (signal?.aborted) {
    throw new Error('Request cancelled by user.');
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), requestTimeoutMs);
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...requestHeaders,
      },
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const errorText = await readErrorText(response);
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(`Request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`);
    }
    if (signal?.aborted || isAbortError(error)) {
      throw new Error('Request cancelled by user.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Creates a new image generation task.
 *
 * @param {string} apiKey User's API Key
 * @param {string} prompt The image prompt
 * @param {Array<string>} imageUrls Array of image URLs (up to 14)
 * @param {string} resolution Target resolution (1K, 2K, 4K)
 * @param {string} aspectRatio Target aspect ratio (auto, 1:1, 4:3, etc)
 * @param {{ signal?: AbortSignal, requestTimeoutMs?: number }} options
 * @returns {Promise<string>} The taskId
 */
export const createTask = async (
  apiKey,
  prompt,
  imageUrls,
  resolution = '1K',
  aspectRatio = 'auto',
  options = {}
) => {
  const payload = {
    model: MODEL_NAME,
    input: {
      prompt,
      image_input: imageUrls,
      aspect_ratio: aspectRatio,
      google_search: false,
      resolution,
      output_format: 'jpg',
    },
  };

  const data = await requestJson(`${API_BASE_URL}/createTask`, apiKey, {
    method: 'POST',
    body: JSON.stringify(payload),
    ...options,
  });

  if (data?.code !== 200 || !data?.data?.taskId) {
    throw new Error(sanitizeApiMessage(data?.msg) || 'Failed to create image task.');
  }

  return data.data.taskId;
};

const extractImageUrlFromTask = (taskData) => {
  try {
    const parsed = taskData?.resultJson ? JSON.parse(taskData.resultJson) : null;
    if (parsed?.resultUrls?.length) return parsed.resultUrls[0];
  } catch {
    // Ignore invalid resultJson and continue to fallback checks.
  }

  if (taskData?.resultUrl) return taskData.resultUrl;
  return null;
};

/**
 * Polls the task status until it completes, fails, times out, or is cancelled.
 *
 * @param {string} apiKey User's API Key
 * @param {string} taskId Task ID to check
 * @param {(state: string, attempt: number) => void} onProgress Callback for status updates
 * @param {{ signal?: AbortSignal, pollIntervalMs?: number, timeoutMs?: number, maxAttempts?: number, requestTimeoutMs?: number }} options
 * @returns {Promise<string>} The final image URL
 */
export const pollTaskStatus = async (apiKey, taskId, onProgress, options = {}) => {
  const {
    signal,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    maxAttempts = Math.ceil(timeoutMs / pollIntervalMs),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = options;

  const startedAt = Date.now();
  const encodedTaskId = encodeURIComponent(taskId);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('Generation cancelled by user.');
    }

    const response = await requestJson(`${API_BASE_URL}/recordInfo?taskId=${encodedTaskId}`, apiKey, {
      method: 'GET',
      signal,
      requestTimeoutMs,
    });

    if (response?.code !== 200) {
      throw new Error(sanitizeApiMessage(response?.msg) || 'Failed to check image generation status.');
    }

    const taskData = response.data || {};
    const state = taskData.state || 'unknown';
    onProgress?.(state, attempt);

    if (state === 'success') {
      const resultUrl = extractImageUrlFromTask(taskData);
      if (!resultUrl) {
        throw new Error('Task reported success but no image URL was returned.');
      }
      return resultUrl;
    }

    if (state === 'fail' || state === 'failed') {
      throw new Error(taskData.failMsg || 'Task failed on the server.');
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs || attempt === maxAttempts) {
      throw new Error(`Image generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    await sleep(pollIntervalMs, signal);
  }

  throw new Error(`Image generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
};

/**
 * Checks the connection to the kie.ai API and gets remaining credits.
 *
 * @param {string} apiKey User's API Key
 * @param {{ signal?: AbortSignal, requestTimeoutMs?: number }} options
 * @returns {Promise<number>} Remaining credits
 */
export const checkConnection = async (apiKey, options = {}) => {
  const data = await requestJson(CREDIT_URL, apiKey, {
    method: 'GET',
    ...options,
  });

  if (data?.code !== 200) {
    throw new Error(sanitizeApiMessage(data?.msg) || 'Connection test failed.');
  }

  return data.data;
};
