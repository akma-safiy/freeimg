/**
 * Service to interact with the GPT-5.2 Chat Completions API on kie.ai
 * Endpoint: https://api.kie.ai/gpt-5-2/v1/chat/completions
 */

const API_BASE_URL = 'https://api.kie.ai/gpt-5-2/v1/chat/completions';
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000; // GPT-5.2 might take time to reason

const isAbortError = (error) => {
  return error?.name === 'AbortError' || /aborted|cancelled/i.test(error?.message ?? '');
};

const assertApiKey = (apiKey) => {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing API key.');
  }
};

const readErrorText = async (response) => {
  try {
    const text = await response.text();
    return text || 'No additional details provided by the API.';
  } catch {
    return 'No additional details provided by the API.';
  }
};

/**
 * Analyzes uploaded images using GPT-5-2 and generates prompt variations.
 * 
 * @param {string} apiKey - User's API Key
 * @param {Array<string>} imageUrls - Array of uploaded image URLs
 * @param {{ signal?: AbortSignal, requestTimeoutMs?: number }} options
 * @returns {Promise<{ basePrompt: string, variations: string[] }>}
 */
export const generatePromptsWithGpt52 = async (apiKey, imageUrls, options = {}) => {
  assertApiKey(apiKey);

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw new Error('No images provided for analysis.');
  }

  const {
    signal,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = options;

  if (signal?.aborted) {
    throw new Error('Analysis cancelled by user.');
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), requestTimeoutMs);
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  // Format images array for OpenAI spec
  const imageContents = imageUrls.map(url => ({
    type: 'image_url',
    image_url: { url }
  }));

  const systemInstructions = `You are a professional AI fashion prompt engineer.
Analyze the provided images to identify their core similarities (clothing style, specific outfit details, person's features, and aesthetic vibe).
Generate a comprehensive, high-quality base text prompt that preserves these core elements but sets them in a stunning, high-end commercial or fashion editorial context.
Provide exactly 4 distinct variation prompts that alter the pose or setting slightly while explicitly maintaining the exact outfit and core subject detail.
You must return the result EXACTLY as a raw JSON object string with no markdown formatting or extra text.
Format: { "basePrompt": "string", "variations": ["var1", "var2", "var3", "var4"] }`;

  const payload = {
    messages: [
      {
        role: 'developer',
        content: [{ type: 'text', text: systemInstructions }]
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze these images and generate the prompt JSON as requested.' },
          ...imageContents
        ]
      }
    ],
    stream: false,
    reasoning_effort: 'high'
  };

  try {
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const errorText = await readErrorText(response);
      throw new Error(`GPT-5-2 API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    if (!data?.choices?.[0]?.message?.content) {
      throw new Error('Unexpected response format from GPT-5-2.');
    }

    const rawContent = data.choices[0].message.content.trim();
    // Sometimes models wrap json in markdown block
    const cleanedContent = rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    
    let parsedResult;
    try {
      parsedResult = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('Failed to parse GPT-5-2 output:', cleanedContent);
      throw new Error('GPT-5-2 returned an invalid format that could not be parsed.');
    }

    if (!parsedResult.basePrompt || !Array.isArray(parsedResult.variations)) {
       throw new Error('GPT-5-2 JSON structure did not match expected schema.');
    }

    return parsedResult;

  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new Error('Analysis cancelled by user.');
    }
    if (timeoutController.signal.aborted) {
      throw new Error(`Analysis timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
};
