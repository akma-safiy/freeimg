/**
 * Direct browser-side image upload to ImgBB.
 * ImgBB supports CORS, so this works directly from the browser.
 * Get a free API key at: https://api.imgbb.com/
 */

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;

const isAbortError = (error) => {
  return error?.name === 'AbortError' || /aborted|cancelled/i.test(error?.message ?? '');
};

/**
 * Extracts the raw base64 payload from a data URI or plain base64 string.
 */
const extractBase64 = (imageData) => {
  if (typeof imageData !== 'string' || !imageData.trim()) {
    throw new Error('Cannot upload an empty image payload.');
  }
  const trimmed = imageData.trim();
  return trimmed.startsWith('data:') ? trimmed.split(',', 2)[1] : trimmed;
};

/**
 * Uploads a local image (data URI or base64) directly to ImgBB from the browser.
 * Falls back to the local proxy if no ImgBB key is configured.
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
    // Try ImgBB direct upload first (browser-safe, no backend needed)
    const imgbbKey = import.meta.env?.VITE_IMGBB_API_KEY;
    if (imgbbKey && imgbbKey !== 'your_imgbb_key_here') {
      return await uploadViaImgBB(imageData, imgbbKey, timeoutController.signal);
    }

    // Fallback: try the local Vite proxy (requires FREEIMAGE_API_KEY in .env)
    return await uploadViaProxy(imageData, timeoutController.signal);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new Error('Upload cancelled by user.');
    }
    if (timeoutController.signal.aborted) {
      throw new Error(`Upload timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw new Error(error?.message || 'Image upload failed.');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Upload directly to ImgBB from the browser.
 */
const uploadViaImgBB = async (imageData, apiKey, signal) => {
  const base64 = extractBase64(imageData);
  const formData = new FormData();
  formData.append('key', apiKey);
  formData.append('image', base64);

  const response = await fetch(IMGBB_UPLOAD_URL, {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) {
    let errMsg = `ImgBB upload failed (${response.status})`;
    try {
      const data = await response.json();
      errMsg = data?.error?.message || errMsg;
    } catch { /* ignore */ }
    throw new Error(errMsg);
  }

  const data = await response.json();
  if (!data?.data?.url) {
    throw new Error('ImgBB returned an invalid upload response.');
  }

  return data.data.url;
};

/**
 * Fallback: Upload via the local Vite proxy endpoint.
 * Requires FREEIMAGE_API_KEY in .env file.
 */
const uploadViaProxy = async (imageData, signal) => {
  const response = await fetch('/api/freeimage/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageData }),
    signal,
  });

  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch { /* ignore */ }

    if (response.status === 500 && message.includes('not configured')) {
      throw new Error(
        'Image upload is not configured. Add VITE_IMGBB_API_KEY to your .env file (get a free key at https://api.imgbb.com/) and restart the dev server.',
      );
    }
    throw new Error(message);
  }

  const data = await response.json();
  if (!data?.url || typeof data.url !== 'string') {
    throw new Error('Upload succeeded but no URL was returned.');
  }

  return data.url;
};
