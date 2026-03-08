const FREEIMAGE_UPLOAD_URL = 'https://freeimage.host/api/1/upload';
const MAX_UPLOAD_BODY_BYTES = 15 * 1024 * 1024;

const BASE64_PAYLOAD_REGEX = /^[A-Za-z0-9+/=]+$/;

export const isAbortError = (error) => {
  return error?.name === 'AbortError' || /aborted|cancelled/i.test(error?.message ?? '');
};

export const extractBase64Payload = (imageInput) => {
  if (typeof imageInput !== 'string' || imageInput.trim() === '') {
    throw new Error('Missing image payload.');
  }

  const trimmed = imageInput.trim();
  const payload = trimmed.startsWith('data:')
    ? trimmed.split(',', 2)[1]
    : trimmed;

  if (!payload || !BASE64_PAYLOAD_REGEX.test(payload)) {
    throw new Error('Invalid image payload. Expected a base64 data URI or base64 string.');
  }

  return payload;
};

const readResponseText = async (response) => {
  try {
    return await response.text();
  } catch {
    return 'Unable to read upstream response.';
  }
};

export const uploadToFreeImage = async ({
  imageInput,
  apiKey,
  signal,
  endpoint = FREEIMAGE_UPLOAD_URL,
}) => {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('FREEIMAGE_API_KEY is not configured on the server.');
  }

  const base64Payload = extractBase64Payload(imageInput);
  const formData = new URLSearchParams();
  formData.append('key', apiKey.trim());
  formData.append('source', base64Payload);
  formData.append('action', 'upload');
  formData.append('format', 'json');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal,
  });

  if (!response.ok) {
    const upstreamText = await readResponseText(response);
    throw new Error(`FreeImage upload failed (${response.status}): ${upstreamText}`);
  }

  const data = await response.json();
  if (data?.status_code !== 200 || !data?.image?.url) {
    throw new Error(data?.error?.message || 'FreeImage returned an invalid upload response.');
  }

  return data.image.url;
};

export const readJsonBody = async (req, maxBytes = MAX_UPLOAD_BODY_BYTES) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytesRead = 0;
    let settled = false;

    const finish = (fn) => (value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const doneResolve = finish(resolve);
    const doneReject = finish(reject);

    req.on('data', (chunk) => {
      bytesRead += chunk.length;
      if (bytesRead > maxBytes) {
        doneReject(new Error(`Request body too large. Limit is ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const bodyString = Buffer.concat(chunks).toString('utf8');
      if (!bodyString) {
        doneResolve({});
        return;
      }

      try {
        doneResolve(JSON.parse(bodyString));
      } catch {
        doneReject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', (error) => {
      doneReject(error);
    });
  });
};

export const createJsonResponse = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const classifyUploadError = (error) => {
  const message = error?.message || 'Unexpected upload error.';
  if (/too large/i.test(message)) return 413;
  if (/invalid json|missing image|invalid image payload/i.test(message)) return 400;
  if (isAbortError(error)) return 499;
  if (/failed \(\d{3}\)/i.test(message)) return 502;
  return 500;
};

