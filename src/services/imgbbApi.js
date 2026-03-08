/**
 * Upload service that proxies uploads through the local backend endpoint.
 * The backend keeps the third-party API key out of browser bundles.
 */

const API_URL = '/api/freeimage/upload';
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;

const isAbortError = (error) => {
  return error?.name === 'AbortError' || /aborted|cancelled/i.test(error?.message ?? '');
};

const readErrorMessage = async (response) => {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.message === 'string') return data.message;
  } catch {
    // Ignore json parse errors and fallback to plain text.
  }

  try {
    return await response.text();
  } catch {
    return 'Upload failed.';
  }
};

/**
 * Uploads a local image payload (data URI / base64) to the backend upload API.
 *
 * @param {string} imageData Base64 image data or data URI.
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} options
 * @returns {Promise<string>} Public URL for the uploaded image.
 */
export const uploadImageToHost = async (imageData, options = {}) => {
  if (typeof imageData !== 'string' || imageData.trim() === '') {
    throw new Error('Cannot upload an empty image payload.');
  }

  const { signal, timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS } = options;

  if (signal?.aborted) {
    throw new Error('Upload cancelled by user.');
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData }),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(`Upload failed (${response.status}): ${message}`);
    }

    const data = await response.json();
    if (!data?.url || typeof data.url !== 'string') {
      throw new Error('Upload succeeded but no URL was returned.');
    }

    return data.url;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new Error('Upload cancelled by user.');
    }
    if (timeoutController.signal.aborted) {
      throw new Error(`Upload timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw new Error(error?.message || 'Upload failed.');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
};
