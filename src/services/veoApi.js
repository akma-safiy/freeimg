/**
 * Service to interact with the Veo 3.1 API from kie.ai
 */

const API_BASE_URL = 'https://api.kie.ai/api/v1/veo';
const JOBS_BASE_URL = 'https://api.kie.ai/api/v1/jobs';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;
const ALLOWED_VIDEO_ASPECT_RATIOS = ['16:9', '9:16', 'Auto'];
const VIDEO_STATUS_ENDPOINTS = [
  (encodedTaskId) => `${API_BASE_URL}/record-info?taskId=${encodedTaskId}`,
  (encodedTaskId) => `${API_BASE_URL}/recordInfo?taskId=${encodedTaskId}`,
  (encodedTaskId) => `${JOBS_BASE_URL}/recordInfo?taskId=${encodedTaskId}`,
];

const isAbortError = (error) => {
  if (!error) return false;
  return error.name === 'AbortError' || /aborted|cancelled/i.test(error.message ?? '');
};

/**
 * Some kie.ai endpoints return the JSON literal string "null" as the `msg`
 * field when they have no specific message to send. Strip those so the
 * `|| fallback` logic works correctly.
 */
const sanitizeApiMessage = (msg) => {
  if (typeof msg !== 'string') return null;
  const trimmed = msg.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
};

const isTransientError = (error) => {
  const message = error?.message ?? '';
  return /timed out|network|failed to fetch|429|500|502|503|504/i.test(message);
};

const isRecordInfoPendingError = (value) => {
  const message = typeof value === 'string' ? value : (value?.message ?? '');
  return /record\s*(?:info)?\s*is\s*null|recordinfo\s*is\s*null|record\s*result\s*data\s*is\s*blank/i.test(message);
};

const isRecordEndpointMissingError = (value) => {
  const message = typeof value === 'string' ? value : (value?.message ?? '');
  return /API Error \(404\)|Cannot (GET|POST)|route not found|path not found/i.test(message);
};

const parseJsonObject = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
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
 * Creates a new video generation task.
 *
 * @param {string} apiKey User's API Key
 * @param {string} prompt The text prompt
 * @param {string[]} imageUrls Image URLs (0 for text2vid, 1-2 for img2vid, 1-3 for ref2vid)
 * @param {string} generationType 'TEXT_2_VIDEO', 'FIRST_AND_LAST_FRAMES_2_VIDEO', or 'REFERENCE_2_VIDEO'
 * @param {string} model 'veo3' or 'veo3_fast'
 * @param {string} aspectRatio '16:9', '9:16', or 'Auto'
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

  if (generationType === 'REFERENCE_2_VIDEO' && (imageUrls.length < 1 || imageUrls.length > 3)) {
    throw new Error('Reference to Video requires 1 to 3 images.');
  }

  if (generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO' && (imageUrls.length < 1 || imageUrls.length > 2)) {
    throw new Error('Image to Video requires 1 or 2 images.');
  }

  if (generationType === 'TEXT_2_VIDEO' && imageUrls.length > 0) {
    // The API ignores imageUrls in text-to-video mode, but keep the check
    // clean – we just omit the field rather than sending an empty array.
  }

  if (!ALLOWED_VIDEO_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new Error(`Invalid video aspect ratio. Allowed values: ${ALLOWED_VIDEO_ASPECT_RATIOS.join(', ')}.`);
  }

  const payload = {
    prompt,
    model,
    aspect_ratio: aspectRatio,
    generationType,
    enableTranslation: true,
    ...(imageUrls.length > 0 && { imageUrls }),
  };

  const data = await requestJson(`${API_BASE_URL}/generate`, apiKey, {
    method: 'POST',
    body: JSON.stringify(payload),
    ...options,
  });

  if (data?.code !== 200 || !data?.data?.taskId) {
    const reason = sanitizeApiMessage(data?.msg);
    throw new Error(reason || `Failed to create video task (code: ${data?.code ?? 'unknown'}). Check that your API key has Veo 3.1 access.`);
  }

  return data.data.taskId;
};

const getVideoStatus = async (apiKey, taskId, options) => {
  const encodedTaskId = encodeURIComponent(taskId);

  let pendingError = null;
  let endpointMissingError = null;

  for (const endpointBuilder of VIDEO_STATUS_ENDPOINTS) {
    try {
      const response = await requestJson(endpointBuilder(encodedTaskId), apiKey, options);
      if (response?.code === 200) {
        return response;
      }

      if (isRecordInfoPendingError(response?.msg)) {
        pendingError = new Error(response.msg || 'recordInfo is null');
        continue;
      }

      if (isRecordEndpointMissingError(response?.msg)) {
        endpointMissingError = new Error(response.msg || 'Status endpoint is unavailable.');
        continue;
      }

      return response;
    } catch (error) {
      if (isRecordInfoPendingError(error)) {
        pendingError = error;
        continue;
      }

      if (isRecordEndpointMissingError(error)) {
        endpointMissingError = error;
        continue;
      }

      throw error;
    }
  }

  if (pendingError) {
    throw pendingError;
  }

  if (endpointMissingError) {
    throw endpointMissingError;
  }

  throw new Error('Failed to check video generation status.');
};

const extractVideoResultUrl = (taskData) => {
  const candidates = [];

  const parsedResponse = parseJsonObject(taskData?.response);
  if (parsedResponse) {
    candidates.push(parsedResponse);
  }

  if (taskData?.resultJson) {
    const parsed = parseJsonObject(taskData.resultJson);
    if (parsed) {
      candidates.push(parsed);
    }
  }

  const parsedInfo = parseJsonObject(taskData?.info);
  if (parsedInfo) {
    candidates.push(parsedInfo);
  }

  candidates.push(taskData);

  for (const candidate of candidates) {
    const nestedResponse = parseJsonObject(candidate?.response);
    const resultContainers = [candidate, nestedResponse];

    for (const container of resultContainers) {
      if (!container) continue;

      const primaryResultUrl = Array.isArray(container?.resultUrls) ? container.resultUrls.find((url) => typeof url === 'string') : null;
      if (primaryResultUrl) return primaryResultUrl;
      if (typeof container?.resultUrl === 'string') return container.resultUrl;
      if (typeof container?.url === 'string') return container.url;
    }
  }

  return null;
};

const normalizeVideoState = (taskData) => {
  if (typeof taskData?.state === 'string' && taskData.state.trim()) {
    return taskData.state.trim().toLowerCase();
  }

  const successFlag = Number(taskData?.successFlag);
  if (Number.isFinite(successFlag)) {
    if (successFlag === 1) return 'success';
    if (successFlag === 2 || successFlag === 3) return 'failed';
    return 'pending';
  }

  return 'pending';
};

const normalizeNumericValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const extractVideoProgress = (taskData) => {
  const parsedResponse = parseJsonObject(taskData?.response);
  return normalizeNumericValue(taskData?.progress) ?? normalizeNumericValue(parsedResponse?.progress);
};

const extractVideoFailureMessage = (taskData) => {
  const parsedResponse = parseJsonObject(taskData?.response);
  const messageCandidates = [
    taskData?.failMsg,
    taskData?.errorMessage,
    parsedResponse?.failMsg,
    parsedResponse?.errorMessage,
    parsedResponse?.message,
  ];

  for (const message of messageCandidates) {
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return 'Video task failed on server.';
};

const createPendingTimeoutError = (timeoutMs) => {
  return new Error(`Video generation is still pending after ${Math.round(timeoutMs / 1000)} seconds. Please try again.`);
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

      if (isRecordInfoPendingError(error)) {
        if (!isFinalAttempt) {
          onProgress?.('retrying', null, attempt);
          await sleep(pollIntervalMs, signal);
          continue;
        }
        throw createPendingTimeoutError(timeoutMs);
      }

      if (!isFinalAttempt && isTransientError(error)) {
        onProgress?.('retrying', null, attempt);
        await sleep(pollIntervalMs, signal);
        continue;
      }

      throw error;
    }

    if (response?.code !== 200) {
      const responseErrorMessage = sanitizeApiMessage(response?.msg) || 'Failed to check video generation status.';
      const elapsedMs = Date.now() - startedAt;
      const isFinalAttempt = attempt === maxAttempts || elapsedMs >= timeoutMs;

      if (isRecordInfoPendingError(responseErrorMessage)) {
        if (!isFinalAttempt) {
          onProgress?.('pending', null, attempt);
          await sleep(pollIntervalMs, signal);
          continue;
        }
        throw createPendingTimeoutError(timeoutMs);
      }

      throw new Error(responseErrorMessage);
    }

    const taskData = response.data || {};
    const state = normalizeVideoState(taskData);
    const progress = extractVideoProgress(taskData);
    onProgress?.(state, progress, attempt);

    if (state === 'success') {
      const resultUrl = extractVideoResultUrl(taskData);
      if (!resultUrl) {
        throw new Error('Task reported success but no video URL was returned.');
      }
      return resultUrl;
    }

    if (state === 'fail' || state === 'failed') {
      throw new Error(extractVideoFailureMessage(taskData));
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs || attempt === maxAttempts) {
      throw new Error(`Video generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    await sleep(pollIntervalMs, signal);
  }

  throw new Error(`Video generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
};
