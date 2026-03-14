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

  const systemInstructions = `You are an expert AI creative director and product photographer specializing in fashion and product campaigns.

TASK: Analyze the reference images deeply and generate prompts that produce FRESH visuals — varied in pose and setting — while keeping the subject/product looking identical.

STEP 1 — IDENTIFY & LOCK THE SUBJECT:
Identify everything that must remain CONSISTENT across all generated images:
- Product: exact garment/item type, fabric, pattern, color, cut, silhouette, branding, and key design details
- Model (if present): approximate skin tone, hair color/style, body type, and overall aesthetic
- Style: editorial style, cultural context, or any distinctive aesthetics visible in the references

STEP 2 — GENERATE THE BASE PROMPT:
Write a single detailed commercial/editorial prompt that:
- Precisely describes the locked product and model characteristics from Step 1
- Places them in a COMPLETELY DIFFERENT pose, camera angle, and environment from any reference
- Sounds like a professional image generation prompt — direct, visual, specific
- Uses strong lighting and fashion photography language

STEP 3 — GENERATE 4 VARIATION PROMPTS:
Each variation must describe the SAME product and model identity but with a uniquely different:
- Camera angle or framing (e.g., overhead, close-up, 3/4 profile, wide shot)
- Setting or environment (e.g., rooftop, studio, street, nature)
- Lighting style (e.g., golden hour, soft studio, dramatic cinematic, neon)
- Pose or stance

You must return ONLY a raw JSON object — no markdown, no preamble, no extra text:
{ "productType": "short label", "basePrompt": "string", "variations": ["var1", "var2", "var3", "var4"] }`;

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

    // Robustly extract the JSON object — the model may wrap it in markdown,
    // reasoning text, or preamble. Find the first '{' and last '}'.
    const jsonStart = rawContent.indexOf('{');
    const jsonEnd   = rawContent.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      console.error('GPT-5-2 raw response (no JSON found):', rawContent);
      throw new Error('GPT-5-2 returned an invalid format that could not be parsed.');
    }
    const jsonSlice = rawContent.slice(jsonStart, jsonEnd + 1);

    let parsedResult;
    try {
      parsedResult = JSON.parse(jsonSlice);
    } catch (parseError) {
      console.error('GPT-5-2 JSON slice that failed to parse:', jsonSlice);
      throw new Error('GPT-5-2 returned an invalid format that could not be parsed.');
    }

    if (!parsedResult.basePrompt || !Array.isArray(parsedResult.variations)) {
       throw new Error('GPT-5-2 JSON structure did not match expected schema.');
    }

    return {
      productType: parsedResult.productType || '',
      basePrompt: parsedResult.basePrompt,
      variations: parsedResult.variations,
    };

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
