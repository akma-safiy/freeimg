/**
 * Service to interact with the Veo 3.1 API from kie.ai
 */

const API_BASE_URL = 'https://api.kie.ai/api/v1/veo';
const JOBS_BASE_URL = 'https://api.kie.ai/api/v1/jobs';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;
const ALLOWED_VIDEO_ASPECT_RATIOS = ['16:9', '9:16'];

const isAbortError = (error) => {
  return error?.name === 'AbortError' || /aborted|cancelled/i.test(error?.message ?? '');
};

const isTransientError = (error) => {
  const message = error?.message ?? '';
  return /timed out|network|failed to fetch|502|503|504/i.test(message);
};

const sleep = (ms, signal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Video generation cancelled by user.'));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Video generation cancelled by user.'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const requestJson = async (url, apiKey, options = {}) => {
  const {
    signal,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    headers: requestHeaders,
    ...fetchOptions
  } = options;

  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing API key.');
  }

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
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText || 'No details.'}`);
    }

    return await response.json();
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new Error('Request cancelled by user.');
    }
    if (timeoutController.signal.aborted) {
      throw new Error(`Request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Creates a new video generation task.
 *
 * @param {string} apiKey User's API Key
 * @param {string} prompt The text prompt
 * @param {Array<string>} imageUrls Array of image URLs (1-2 for img2vid, 3 for ref2vid)
 * @param {string} generationType 'FIRST_AND_LAST_FRAMES_2_VIDEO' or 'REFERENCE_2_VIDEO'
 * @param {string} model 'veo3' or 'veo3_fast'
 * @param {string} aspectRatio '16:9' or '9:16'
 * @param {{ signal?: AbortSignal, requestTimeoutMs?: number }} options
 * @returns {Promise<string>} The taskId
 */
export const createVideoTask = async (
  apiKey,
  prompt,
  imageUrls,
  generationType,
  model = 'veo3_fast',
  aspectRatio = '16:9',
  options = {}
) => {
  if (generationType === 'REFERENCE_2_VIDEO' && model !== 'veo3_fast') {
    throw new Error('Reference to Video only supports the veo3_fast model.');
  }

  if (generationType === 'REFERENCE_2_VIDEO' && imageUrls.length !== 3) {
    throw new Error('Reference to Video requires exactly 3 images.');
  }

  if (generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO' && (imageUrls.length < 1 || imageUrls.length > 2)) {
    throw new Error('Image to Video requires 1 or 2 images.');
  }

  if (!ALLOWED_VIDEO_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new Error('Invalid video aspect ratio. Allowed values: 16:9 or 9:16.');
  }

  const payload = {
    prompt,
    imageUrls,
    model,
    aspect_ratio: aspectRatio,
    generationType,
    enableTranslation: true,
  };

  const data = await requestJson(`${API_BASE_URL}/generate`, apiKey, {
    method: 'POST',
    body: JSON.stringify(payload),
    ...options,
  });

  if (data?.code !== 200 || !data?.data?.taskId) {
    throw new Error(data?.msg || 'Failed to create video task.');
  }

  return data.data.taskId;
};

const getVideoStatus = async (apiKey, taskId, options) => {
  const encodedTaskId = encodeURIComponent(taskId);
  try {
    return await requestJson(`${API_BASE_URL}/recordInfo?taskId=${encodedTaskId}`, apiKey, options);
  } catch (error) {
    if (!/API Error \(404\)/.test(error?.message ?? '')) {
      throw error;
    }

    return requestJson(`${JOBS_BASE_URL}/recordInfo?taskId=${encodedTaskId}`, apiKey, options);
  }
};

const extractVideoResultUrl = (taskData) => {
  const candidates = [];

  if (taskData?.resultJson) {
    try {
      const parsed = JSON.parse(taskData.resultJson);
      candidates.push(parsed);
    } catch {
      // Ignore malformed JSON and continue with other candidates.
    }
  }

  if (taskData?.info) {
    candidates.push(taskData.info);
  }

  candidates.push(taskData);

  for (const candidate of candidates) {
    if (candidate?.resultUrls?.length) return candidate.resultUrls[0];
    if (typeof candidate?.resultUrl === 'string') return candidate.resultUrl;
    if (typeof candidate?.url === 'string') return candidate.url;
  }

  return null;
};

/**
 * Polls the task status until it completes, fails, times out, or is cancelled.
 *
 * @param {string} apiKey User's API Key
 * @param {string} taskId Task ID to check
 * @param {(state: string, progress: number | null, attempt: number) => void} onProgress Callback for status updates
 * @param {{ signal?: AbortSignal, pollIntervalMs?: number, timeoutMs?: number, maxAttempts?: number, requestTimeoutMs?: number }} options
 * @returns {Promise<string>} The final video URL
 */
export const pollVideoStatus = async (apiKey, taskId, onProgress, options = {}) => {
  const {
    signal,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    maxAttempts = Math.ceil(timeoutMs / pollIntervalMs),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = options;

  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('Video generation cancelled by user.');
    }

    let response;
    try {
      response = await getVideoStatus(apiKey, taskId, {
        method: 'GET',
        signal,
        requestTimeoutMs,
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const isFinalAttempt = attempt === maxAttempts || elapsedMs >= timeoutMs;

      if (!isFinalAttempt && isTransientError(error)) {
        onProgress?.('retrying', null, attempt);
        await sleep(pollIntervalMs, signal);
        continue;
      }

      throw error;
    }

    if (response?.code !== 200) {
      throw new Error(response?.msg || 'Failed to check video generation status.');
    }

    const taskData = response.data || {};
    const state = taskData.state || 'unknown';
    const progress = typeof taskData.progress === 'number' ? taskData.progress : null;
    onProgress?.(state, progress, attempt);

    if (state === 'success') {
      const resultUrl = extractVideoResultUrl(taskData);
      if (!resultUrl) {
        throw new Error('Task reported success but no video URL was returned.');
      }
      return resultUrl;
    }

    if (state === 'fail' || state === 'failed') {
      throw new Error(taskData.failMsg || 'Video task failed on server.');
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs || attempt === maxAttempts) {
      throw new Error(`Video generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    await sleep(pollIntervalMs, signal);
  }

  throw new Error(`Video generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
};
