import { useState, useRef, useEffect } from 'react';
import { Settings, Image as ImageIcon, Sparkles, Download, Loader2, Plus, X, AlertCircle, Video, LayoutTemplate, Wand2, History, Trash2 } from 'lucide-react';
import { createTask, pollTaskStatus, checkConnection } from './services/nanoBananaApi';
import { createVideoTask, pollVideoStatus } from './services/veoApi';
import { uploadImageToHost } from './services/imgbbApi';

const DEFAULT_IMAGE_PROMPT = 'A highly detailed cinematic shot of the outfit in a neon-lit cyberpunk city street';
const DEFAULT_VARIATION_PROMPTS = [
  "Pose 1: Standing straight, maintain camera angle, setting, and outfit",
  "Pose 2: Hands on hips, casual stance, maintain camera angle, setting, and outfit",
  "Pose 3: Looking over shoulder, dynamic stance, maintain camera angle, setting, and outfit",
  "Pose 4: Walking forward, maintain camera angle, setting, and outfit",
];
const FALLBACK_SUGGESTED_BASE_PROMPT = 'Premium e-commerce fashion capture of the same outfit, preserve exact garment design, fabric weave, color accuracy, and silhouette. Use balanced studio lighting, maintain clean professional styling and product-first composition.';
const FALLBACK_VARIATION_PROMPTS = [
  'Front-facing hero shot, garment symmetry preserved, catalog-ready composition.',
  'Three-quarter angle with subtle depth, preserve stitching and texture detail.',
  'Close-up fabric-detail emphasis while maintaining true color and material quality.',
  'Editorial movement pose with clear outfit readability and premium commercial finish.',
];
const API_KEY_STORAGE_KEY = 'outfit_ai_api_key_v1';

const classifyBrightness = (brightnessValue) => {
  if (brightnessValue < 85) return 'dramatic low-key';
  if (brightnessValue < 140) return 'balanced studio';
  return 'high-key clean';
};

const classifyColorMood = (r, g, b) => {
  if (r > g + 18 && r > b + 18) return 'warm editorial tones';
  if (b > r + 18 && b > g + 18) return 'cool polished tones';
  if (g > r + 18 && g > b + 18) return 'fresh natural tones';
  return 'neutral true-to-fabric tones';
};

const analyzeUploadedImage = async (imageUrl) => {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to analyze this image source.'));
    img.src = imageUrl;
  });

  const sampleWidth = 64;
  const sampleHeight = 64;
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas context unavailable.');

  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixelData = context.getImageData(0, 0, sampleWidth, sampleHeight).data;

  let red = 0;
  let green = 0;
  let blue = 0;
  let alphaPixels = 0;
  for (let i = 0; i < pixelData.length; i += 4) {
    const alpha = pixelData[i + 3];
    if (alpha < 5) continue;
    red += pixelData[i];
    green += pixelData[i + 1];
    blue += pixelData[i + 2];
    alphaPixels += 1;
  }

  if (alphaPixels === 0) {
    throw new Error('Not enough visual data to analyze.');
  }

  red /= alphaPixels;
  green /= alphaPixels;
  blue /= alphaPixels;
  const brightness = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const orientation = image.width >= image.height ? 'landscape' : 'portrait';

  return {
    brightness,
    orientation,
    colorMood: classifyColorMood(red, green, blue),
    lightingStyle: classifyBrightness(brightness),
  };
};

const buildPromptSuggestions = (analysis) => {
  const basePromptSuggestion = `Premium e-commerce fashion capture of the same outfit, preserve exact garment design, fabric weave, color accuracy, and silhouette. Use ${analysis.lightingStyle} lighting with ${analysis.colorMood}, maintain a ${analysis.orientation} framing and clean professional styling.`;
  const variationSuggestions = [...FALLBACK_VARIATION_PROMPTS];

  return { basePromptSuggestion, variationSuggestions };
};

function App() {
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('idle'); // idle, success, error
  const [connectionMessage, setConnectionMessage] = useState('');
  const [credits, setCredits] = useState(null);

  // App State
  const [activeTab, setActiveTab] = useState('image'); // 'image' or 'video'
  const [mobileView, setMobileView] = useState('controls'); // 'controls' or 'preview'

  // Image Gen State
  const [images, setImages] = useState([]);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef(null);

  const [prompt, setPrompt] = useState(DEFAULT_IMAGE_PROMPT);
  const [numOutputs, setNumOutputs] = useState(4);
  const [posePrompts, setPosePrompts] = useState([...DEFAULT_VARIATION_PROMPTS]);
  const [resolution, setResolution] = useState('1K');
  const [aspectRatio, setAspectRatio] = useState('auto');

  // Video Gen State
  const [videoPrompt, setVideoPrompt] = useState('A cinematic slow-motion pan showcasing the stunning fabric textures, natural lighting');
  const [videoGenerationType, setVideoGenerationType] = useState('img2vid'); // 'img2vid' or 'ref2vid'
  const [videoModel, setVideoModel] = useState('veo3_fast');
  const [videoAspectRatio, setVideoAspectRatio] = useState('16:9');
  const [videoResultUrl, setVideoResultUrl] = useState(null);

  // Common State
  const [isGenerating, setIsGenerating] = useState(false);
  const [taskState, setTaskState] = useState('');
  const [resultImages, setResultImages] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [error, setError] = useState(null);
  const [generationHistory, setGenerationHistory] = useState([]);
  const currentResultValid = activeTab === 'image' ? (resultImages && resultImages.length > 0) : videoResultUrl;
  const [isAnalyzingSuggestions, setIsAnalyzingSuggestions] = useState(false);
  const [suggestedBasePrompt, setSuggestedBasePrompt] = useState('');
  const [suggestedVariationPrompts, setSuggestedVariationPrompts] = useState([]);

  // Timer state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const MAX_IMAGES = 14;
  const MAX_FILE_SIZE_MB = 10;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
  const HISTORY_STORAGE_KEY = 'outfit_ai_history_v1';
  const MAX_HISTORY_ITEMS = 40;
  const VIDEO_ASPECT_RATIOS = ['16:9', '9:16'];
  const generationControllerRef = useRef(null);
  const taskStateClearTimeoutRef = useRef(null);

  const buildId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const toNumberOrNull = (value) => {
    if (typeof value !== 'number') return null;
    if (!Number.isFinite(value)) return null;
    return value;
  };

  const getResultImageUrl = (resultItem) => {
    if (typeof resultItem === 'string') return resultItem;
    return resultItem?.url || '';
  };

  const getResultImageCost = (resultItem) => {
    if (!resultItem || typeof resultItem === 'string') return null;
    return toNumberOrNull(resultItem.tokenUsed);
  };

  const createResultImage = (url, tokenUsed = null, tokenMode = 'unknown', metadata = {}) => ({
    id: buildId('img'),
    url,
    tokenUsed: toNumberOrNull(tokenUsed),
    tokenMode,
    promptUsed: typeof metadata?.promptUsed === 'string' ? metadata.promptUsed : '',
    createdAt: new Date().toISOString(),
  });

  const getResultImagePrompt = (resultItem) => {
    if (!resultItem || typeof resultItem === 'string') return '';
    return typeof resultItem.promptUsed === 'string' ? resultItem.promptUsed : '';
  };

  const splitCostAcrossImages = (totalCost, count) => {
    if (!Number.isFinite(totalCost) || count <= 0) return Array(count).fill(null);
    const perImage = Number((totalCost / count).toFixed(2));
    return Array(count).fill(perImage);
  };

  const getTokenCostLabel = (tokenCost, mode = 'estimated') => {
    if (!Number.isFinite(tokenCost)) {
      return 'Cost unavailable';
    }
    const formatted = Number.isInteger(tokenCost) ? tokenCost.toString() : tokenCost.toFixed(2);
    if (mode === 'estimated') return `-${formatted} tokens (est.)`;
    return `-${formatted} tokens`;
  };

  const formatHistoryDate = (isoDate) => {
    try {
      return new Date(isoDate).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return isoDate;
    }
  };

  const appendHistoryEntry = (entry) => {
    setGenerationHistory((previous) => {
      const next = [entry, ...previous].slice(0, MAX_HISTORY_ITEMS);
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch (storageError) {
        console.error('Failed to persist history:', storageError);
      }
      return next;
    });
  };

  const clearHistory = () => {
    setGenerationHistory([]);
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch (storageError) {
      console.error('Failed to clear history:', storageError);
    }
  };

  const isAbortError = (err) => {
    return err?.name === 'AbortError' || /aborted|cancelled/i.test(err?.message ?? '');
  };

  const clearPendingTaskStateReset = () => {
    if (taskStateClearTimeoutRef.current) {
      clearTimeout(taskStateClearTimeoutRef.current);
      taskStateClearTimeoutRef.current = null;
    }
  };

  const scheduleTaskStateReset = (delayMs = 3000) => {
    clearPendingTaskStateReset();
    taskStateClearTimeoutRef.current = setTimeout(() => {
      setTaskState('');
    }, delayMs);
  };

  const createGenerationController = () => {
    generationControllerRef.current?.abort();
    clearPendingTaskStateReset();
    const controller = new AbortController();
    generationControllerRef.current = controller;
    return controller;
  };

  const finalizeGeneration = (controller) => {
    if (generationControllerRef.current === controller) {
      generationControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  const refreshCredits = async (key, signal) => {
    try {
      const currentCredits = await checkConnection(key, { signal });
      setCredits(currentCredits);
      return currentCredits;
    } catch (creditError) {
      if (!isAbortError(creditError)) {
        console.error('Failed to refresh credits:', creditError);
      }
      return null;
    }
  };

  const normalizeHttpsImageUrl = (value) => {
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== 'https:') return null;
      return parsed.toString();
    } catch {
      return null;
    }
  };

  // Handle generation timer
  useEffect(() => {
    let intervalId;
    if (isGenerating) {
      setElapsedSeconds(0);
      intervalId = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(intervalId);
  }, [isGenerating]);

  useEffect(() => {
    return () => {
      generationControllerRef.current?.abort();
      if (taskStateClearTimeoutRef.current) {
        clearTimeout(taskStateClearTimeoutRef.current);
        taskStateClearTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isGenerating) {
      setMobileView('preview');
    }
  }, [isGenerating]);

  useEffect(() => {
    try {
      const normalizedApiKey = apiKey.trim();
      if (!normalizedApiKey) {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        return;
      }
      localStorage.setItem(API_KEY_STORAGE_KEY, normalizedApiKey);
    } catch (storageError) {
      console.error('Failed to persist API key:', storageError);
    }
  }, [apiKey]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setGenerationHistory(parsed);
      }
    } catch (storageError) {
      console.error('Failed to load history:', storageError);
    }
  }, []);

  useEffect(() => {
    if (images.length === 0) {
      setSuggestedBasePrompt('');
      setSuggestedVariationPrompts([]);
      setIsAnalyzingSuggestions(false);
      return;
    }

    let isCancelled = false;
    const primaryImageUrl = images[0]?.url;

    const applySuggestions = (basePromptSuggestion, variationSuggestions) => {
      if (isCancelled) return;

      const safeVariations = Array.isArray(variationSuggestions) && variationSuggestions.length > 0
        ? variationSuggestions.slice(0, 4)
        : [...FALLBACK_VARIATION_PROMPTS];
      const safeBasePrompt = typeof basePromptSuggestion === 'string' && basePromptSuggestion.trim()
        ? basePromptSuggestion.trim()
        : FALLBACK_SUGGESTED_BASE_PROMPT;

      setSuggestedBasePrompt(safeBasePrompt);
      setSuggestedVariationPrompts(safeVariations);
      setPosePrompts((previousPrompts) => {
        const nextPrompts = [...previousPrompts];
        safeVariations.forEach((suggestion, index) => {
          nextPrompts[index] = suggestion;
        });
        return nextPrompts;
      });
      setPrompt((previousPrompt) => {
        const normalizedPrompt = (previousPrompt || '').trim();
        const shouldUseSuggestedPrompt = !normalizedPrompt
          || normalizedPrompt === DEFAULT_IMAGE_PROMPT
          || normalizedPrompt === FALLBACK_SUGGESTED_BASE_PROMPT;
        return shouldUseSuggestedPrompt ? safeBasePrompt : previousPrompt;
      });
    };

    if (!primaryImageUrl) {
      applySuggestions(FALLBACK_SUGGESTED_BASE_PROMPT, FALLBACK_VARIATION_PROMPTS);
      return;
    }

    setIsAnalyzingSuggestions(true);

    const runAnalysis = async () => {
      try {
        const analysis = await analyzeUploadedImage(primaryImageUrl);
        if (isCancelled) return;

        const suggestions = buildPromptSuggestions(analysis);
        applySuggestions(suggestions.basePromptSuggestion, suggestions.variationSuggestions);
      } catch (analysisError) {
        console.error('Failed to analyze uploaded image for prompt suggestions:', analysisError);
        applySuggestions(FALLBACK_SUGGESTED_BASE_PROMPT, FALLBACK_VARIATION_PROMPTS);
      } finally {
        if (!isCancelled) {
          setIsAnalyzingSuggestions(false);
        }
      }
    };

    runAnalysis();

    return () => {
      isCancelled = true;
    };
  }, [images]);

  const readFileAsDataUrl = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Unable to read image file.'));
      reader.readAsDataURL(file);
    });
  };

  const appendLocalImage = (dataUrl) => {
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) return prev;
      return [...prev, { id: Date.now() + Math.random(), url: dataUrl, isLocal: true }];
    });
  };

  const handleUrlInputPaste = async (event) => {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageItem = clipboardItems.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;

    event.preventDefault();

    if (images.length >= MAX_IMAGES) {
      setError(`You can only upload up to ${MAX_IMAGES} images.`);
      return;
    }

    const imageFile = imageItem.getAsFile();
    if (!imageFile) {
      setError('Could not read pasted image. Please try again.');
      return;
    }

    if (imageFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`Pasted image exceeds ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(imageFile);
      appendLocalImage(dataUrl);
      setError(null);
      setTaskState('Image pasted from clipboard.');
      scheduleTaskStateReset(1800);
    } catch (pasteError) {
      setError(pasteError.message || 'Failed to paste image.');
    }
  };

  const handleAddUrl = () => {
    if (!urlInput.trim()) return;
    if (images.length >= MAX_IMAGES) {
      setError(`You can only upload up to ${MAX_IMAGES} images.`);
      return;
    }

    const normalizedUrl = normalizeHttpsImageUrl(urlInput);
    if (!normalizedUrl) {
      setError('Please provide a valid HTTPS image URL.');
      return;
    }

    if (images.some((image) => image.url === normalizedUrl)) {
      setError('This image URL has already been added.');
      return;
    }

    setImages((prev) => [...prev, { id: Date.now() + Math.random(), url: normalizedUrl, isLocal: false }]);
    setUrlInput('');
    setError(null);
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    let rejectedNonImage = false;
    let rejectedOversized = false;
    const validFiles = files.filter((file) => {
      if (!file.type.startsWith('image/')) {
        rejectedNonImage = true;
        return false;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejectedOversized = true;
        return false;
      }

      return true;
    });

    if (images.length + validFiles.length > MAX_IMAGES) {
      setError(`You can only upload up to ${MAX_IMAGES} images. Please select fewer files.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (validFiles.length === 0) {
      const reasons = [];
      if (rejectedNonImage) reasons.push('some files were not images');
      if (rejectedOversized) reasons.push(`some files exceeded ${MAX_FILE_SIZE_MB}MB`);
      setError(`No valid files were added (${reasons.join(', ')}).`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImages((prev) => {
          if (prev.length >= MAX_IMAGES) return prev;
          return [...prev, { id: Date.now() + Math.random(), url: event.target.result, isLocal: true }];
        });
      };
      reader.readAsDataURL(file);
    });

    if (rejectedNonImage || rejectedOversized) {
      const reasons = [];
      if (rejectedNonImage) reasons.push('some files were not images');
      if (rejectedOversized) reasons.push(`some files exceeded ${MAX_FILE_SIZE_MB}MB`);
      setError(`Added valid files, but ${reasons.join(' and ')}.`);
    } else {
      setError(null);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (idToRemove) => {
    setImages(prev => prev.filter(img => img.id !== idToRemove));
  };

  const handleTestConnection = async () => {
    if (!apiKey) {
      setConnectionStatus('error');
      setConnectionMessage('Please enter an API key first.');
      setCredits(null);
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus('idle');
    setConnectionMessage('');
    setCredits(null);

    try {
      const currentCredits = await checkConnection(apiKey, { requestTimeoutMs: 20_000 });
      setConnectionStatus('success');
      setCredits(currentCredits);
      setConnectionMessage('Connected successfully!');
    } catch (err) {
      setConnectionStatus('error');
      setCredits(null);
      setConnectionMessage(err.message || 'Failed to connect. Please check your API key.');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setResultImages(null);
    setSelectedResult(null);
    clearPendingTaskStateReset();

    const key = apiKey.trim();
    if (!key) {
      setError('Please enter your kie.ai API key to begin.');
      return;
    }

    if (images.length === 0) {
      setError('Please provide at least one source image.');
      return;
    }

    const controller = createGenerationController();
    let generationFailed = false;
    let creditsBefore = toNumberOrNull(credits);
    let creditsAfter = null;

    try {
      setIsGenerating(true);
      setTaskState('Preparing images...');

      if (creditsBefore === null) {
        try {
          creditsBefore = await checkConnection(key, { signal: controller.signal });
          setCredits(creditsBefore);
        } catch {
          creditsBefore = null;
        }
      }

      const imageUrls = [];
      for (const img of images) {
        if (img.isLocal || img.url.startsWith('data:')) {
          setTaskState('Uploading local image to secure host...');
          const remoteUrl = await uploadImageToHost(img.url, { signal: controller.signal });
          imageUrls.push(remoteUrl);
        } else {
          imageUrls.push(img.url);
        }
      }

      setTaskState(`Initiating ${numOutputs} parallel AI synthesis tasks...`);

      const basePrompt = (prompt || '').trim() || DEFAULT_IMAGE_PROMPT;
      const activePoses = posePrompts
        .slice(0, numOutputs)
        .map((pose, index) => (typeof pose === 'string' && pose.trim()
          ? pose.trim()
          : `Variation ${index + 1}: maintain outfit details and quality.`));
      const fullPrompts = activePoses.map((pose) => `${basePrompt}. ${pose}`);

      const taskIds = await Promise.all(
        fullPrompts.map((fullPrompt) =>
          createTask(key, fullPrompt, imageUrls, resolution, aspectRatio, {
            signal: controller.signal,
          })
        )
      );

      setTaskState('Tasks created. Waiting for AI generation (this may take a minute)...');

      let completedTasks = 0;

      const finalImages = await Promise.all(
        taskIds.map(async (taskId) => {
          const result = await pollTaskStatus(key, taskId, null, {
            signal: controller.signal,
          });
          completedTasks += 1;
          setTaskState(`Generation progress: ${completedTasks}/${numOutputs} complete...`);
          return result;
        })
      );

      creditsAfter = await refreshCredits(key, controller.signal);
      const totalTokenUsed = (Number.isFinite(creditsBefore) && Number.isFinite(creditsAfter))
        ? Math.max(0, Number((creditsBefore - creditsAfter).toFixed(2)))
        : null;
      const costSplit = splitCostAcrossImages(totalTokenUsed, finalImages.length);
      const enrichedResults = finalImages.map((url, index) =>
        createResultImage(url, costSplit[index], 'estimated', {
          promptUsed: fullPrompts[index] || basePrompt,
        })
      );

      setResultImages(enrichedResults);
      setTaskState('');
      setMobileView('preview');

      appendHistoryEntry({
        id: buildId('hist'),
        createdAt: new Date().toISOString(),
        prompt: basePrompt,
        sourceCount: images.length,
        resolution,
        aspectRatio,
        totalTokenUsed,
        costMode: Number.isFinite(totalTokenUsed) ? 'estimated' : 'unknown',
        outputs: enrichedResults,
      });
    } catch (err) {
      generationFailed = true;
      setError(isAbortError(err) ? 'Generation cancelled.' : (err.message || 'An error occurred during generation.'));
    } finally {
      finalizeGeneration(controller);
      if (!generationFailed && !Number.isFinite(creditsAfter)) {
        await refreshCredits(key);
      }
    }
  };

  const handleVideoGenerate = async () => {
    clearPendingTaskStateReset();
    const key = apiKey.trim();
    if (!key) {
      setError('Please enter your kie.ai API key to begin.');
      return;
    }

    // Constraints check
    if (videoGenerationType === 'img2vid') {
      if (images.length < 1 || images.length > 2) {
        setError('Image-to-Video requires exactly 1 or 2 images (First & Last Frame).');
        return;
      }
    } else if (videoGenerationType === 'ref2vid') {
      if (images.length !== 3) {
        setError('Reference-to-Video requires exactly 3 images.');
        return;
      }
    }

    const normalizedVideoAspectRatio = VIDEO_ASPECT_RATIOS.includes(videoAspectRatio)
      ? videoAspectRatio
      : '16:9';

    const controller = createGenerationController();
    let generationFailed = false;

    try {
      setIsGenerating(true);
      setError(null);
      setVideoResultUrl(null);
      setTaskState('Preparing images & checking constraints...');

      const imageUrls = [];
      for (const img of images) {
        if (img.isLocal || img.url.startsWith('data:')) {
          setTaskState('Uploading local image to secure host...');
          const remoteUrl = await uploadImageToHost(img.url, { signal: controller.signal });
          imageUrls.push(remoteUrl);
        } else {
          imageUrls.push(img.url);
        }
      }

      setTaskState('Initiating AI Video Synthesis...');

      const apiGenType = videoGenerationType === 'img2vid' ? 'FIRST_AND_LAST_FRAMES_2_VIDEO' : 'REFERENCE_2_VIDEO';
      const actualModel = videoGenerationType === 'ref2vid' ? 'veo3_fast' : videoModel; // ref2vid forces fast

      const taskId = await createVideoTask(
        key,
        videoPrompt,
        imageUrls,
        apiGenType,
        actualModel,
        normalizedVideoAspectRatio,
        { signal: controller.signal }
      );

      setTaskState(`Task created (${taskId}). Waiting for Veo 3.1 to generate video...`);

      const finalVideo = await pollVideoStatus(key, taskId, (state) => {
        setTaskState(`Task status: ${state}...`);
      }, {
        signal: controller.signal,
      });

      setVideoResultUrl(finalVideo);
      setTaskState('Video Generation Complete!');
      setMobileView('preview');

    } catch (err) {
      generationFailed = true;
      setError(isAbortError(err) ? 'Video generation cancelled.' : (err.message || 'An unexpected error occurred during generation.'));
    } finally {
      finalizeGeneration(controller);
      if (!generationFailed) {
        await refreshCredits(key);
      }
    }
  };

  const handleEnhanceTo4K = async (imageUrl) => {
    const key = apiKey.trim();
    if (!key) {
      setError('Please enter your kie.ai API key to begin.');
      return;
    }

    if (!imageUrl || selectedResult === null) {
      setError('Please select a result image before enhancing.');
      return;
    }

    clearPendingTaskStateReset();
    const targetIndex = selectedResult;
    const controller = createGenerationController();
    let enhancementFailed = false;
    let creditsBefore = toNumberOrNull(credits);
    let creditsAfter = null;

    try {
      setError(null);
      setIsGenerating(true);
      setTaskState('Initiating 4K Enhancement Task...');

      if (creditsBefore === null) {
        try {
          creditsBefore = await checkConnection(key, { signal: controller.signal });
          setCredits(creditsBefore);
        } catch {
          creditsBefore = null;
        }
      }

      const sourcePrompt = getResultImagePrompt(resultImages?.[targetIndex]);
      const basePrompt = sourcePrompt || (prompt || '').trim() || DEFAULT_IMAGE_PROMPT;
      const enhancementPrompt = `${basePrompt}. Enhance strictly to 4K resolution, exact match.`;

      const taskId = await createTask(key, enhancementPrompt, [imageUrl], '4K', aspectRatio, {
        signal: controller.signal,
      });

      setTaskState('4K Task created. Waiting for high-resolution synthesis...');

      const finalImage = await pollTaskStatus(key, taskId, null, {
        signal: controller.signal,
      });

      creditsAfter = await refreshCredits(key, controller.signal);
      const tokenUsed = (Number.isFinite(creditsBefore) && Number.isFinite(creditsAfter))
        ? Math.max(0, Number((creditsBefore - creditsAfter).toFixed(2)))
        : null;

      setResultImages((previousResults) => {
        if (!previousResults || targetIndex >= previousResults.length) return previousResults;
        const updatedResults = [...previousResults];
        updatedResults[targetIndex] = createResultImage(finalImage, tokenUsed, 'estimated', {
          promptUsed: enhancementPrompt,
        });
        return updatedResults;
      });
      setTaskState('4K Enhancement Complete!');
      scheduleTaskStateReset(3000);
      setMobileView('preview');
    } catch (err) {
      enhancementFailed = true;
      setError(isAbortError(err) ? 'Enhancement cancelled.' : (err.message || 'Failed to enhance image.'));
    } finally {
      finalizeGeneration(controller);
      if (!enhancementFailed && !Number.isFinite(creditsAfter)) {
        await refreshCredits(key);
      }
    }
  };

  const handleRegenerateFromVariant = (imageUrl) => {
    // Take this specific image, wipe the current inputs, and set it as the new primary image
    setImages([{ id: Date.now(), url: imageUrl, isLocal: false }]);
    setResultImages(null);
    setSelectedResult(null);
    setPrompt('Refine this variation: ');
    setMobileView('controls');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenHistoryEntry = (entry) => {
    const outputs = Array.isArray(entry?.outputs) ? entry.outputs : [];
    if (outputs.length === 0) return;

    const hydrated = outputs
      .map((item) => {
        const url = getResultImageUrl(item);
        const promptUsed = getResultImagePrompt(item);
        if (!url) return null;
        return createResultImage(url, getResultImageCost(item), item?.tokenMode || entry?.costMode || 'unknown', {
          promptUsed: promptUsed || entry?.prompt || '',
        });
      })
      .filter(Boolean);

    if (!hydrated.length) return;

    setActiveTab('image');
    setVideoResultUrl(null);
    setSelectedResult(null);
    setResultImages(hydrated);
    if (typeof entry?.prompt === 'string' && entry.prompt.trim()) {
      setPrompt(entry.prompt);
    }
    setMobileView('preview');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-[#0A2342]/20 pb-24 lg:pb-0">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-[#0A2342]" />
            <h1 className="font-bold text-base sm:text-xl tracking-tight text-slate-900">Outfit<span className="text-[#0A2342]">AI</span> Studio</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-sm font-medium">
            <div className="bg-slate-100 rounded-full p-1 flex items-center border border-slate-200 shadow-inner">
              <button
                onClick={() => {
                  setActiveTab('image');
                  setMobileView('controls');
                }}
                className={`px-3 sm:px-6 py-2.5 rounded-full transition-all flex items-center gap-1.5 sm:gap-2 font-medium text-xs sm:text-sm ${activeTab === 'image' ? 'bg-[#0A2342] text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'}`}
              >
                <ImageIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Outfit Image</span>
                <span className="sm:hidden">Image</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('video');
                  setMobileView('controls');
                }}
                className={`px-3 sm:px-6 py-2.5 rounded-full transition-all flex items-center gap-1.5 sm:gap-2 font-medium text-xs sm:text-sm ${activeTab === 'video' ? 'bg-[#0A2342] text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'}`}
              >
                <Video className="w-4 h-4" />
                <span className="hidden sm:inline">Veo 3.1 Video</span>
                <span className="sm:hidden">Video</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[90rem] mx-auto px-4 sm:px-6 py-4 sm:py-8 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 items-start">

        <div className={`${mobileView === 'controls' ? 'block' : 'hidden'} lg:block lg:col-span-5 xl:col-span-4 space-y-4 sm:space-y-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto no-scrollbar pb-2 lg:pb-12 lg:pr-2`}>

          {/* API Connection Panel */}
          <div className="p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] bg-white border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2 text-[#0A2342]">
                <Settings className="w-5 h-5" />
                <h2 className="font-semibold text-slate-800">Connection</h2>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full border border-slate-200 shadow-sm">
                <div className={`w-2 h-2 rounded-full transition-all duration-500 ${connectionStatus === 'success' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : connectionStatus === 'error' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-slate-300'}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${connectionStatus === 'success' ? 'text-green-600' : connectionStatus === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                  {connectionStatus === 'success' ? 'Secure' : connectionStatus === 'error' ? 'Error' : 'Offline'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Kie.ai Access Token</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setConnectionStatus('idle');
                    setConnectionMessage('');
                    setCredits(null);
                  }}
                  placeholder="Paste Bearer Token..."
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-[#0A2342] focus:ring-1 focus:ring-[#0A2342] transition-all placeholder:text-slate-400 text-slate-800"
                />
                <button
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !apiKey}
                  className={`px-6 py-4 rounded-2xl font-bold flex items-center justify-center w-full sm:w-auto sm:min-w-[100px] gap-2 transition-all ${isTestingConnection || !apiKey ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#0A2342] hover:bg-[#15345d] text-white shadow-md active:scale-95'}`}
                >
                  {isTestingConnection ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sync'}
                </button>
              </div>
            </div>

            {connectionStatus === 'success' && credits !== null && (
              <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex justify-between items-center text-sm transition-all duration-300">
                <div className="flex items-center gap-2 text-emerald-800">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-semibold">Credits Available</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-emerald-700 text-lg tracking-tight">
                    {credits}
                  </span>
                </div>
              </div>
            )}

            {connectionStatus === 'error' && (
              <div className="mt-4 bg-rose-50 border border-rose-100 rounded-2xl p-4 flex items-start flex-col gap-1 text-sm text-rose-600 transition-all duration-300">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Connection Failed</span>
                </div>
                <span className="text-xs text-rose-500 ml-6 break-words w-full font-medium">{connectionMessage}</span>
              </div>
            )}
          </div>

          {/* Input Panel */}
          <div className="p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] bg-white border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5 sm:space-y-6">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-semibold text-lg text-slate-800">Generation Settings</h2>
              <span className="text-xs bg-slate-100 px-3 py-1 rounded-full text-slate-500 font-bold border border-slate-200">
                {images.length} / {MAX_IMAGES} Configured
              </span>
            </div>

            {/* Contextual Warning based on Tab */}
            {activeTab === 'video' && videoGenerationType === 'img2vid' && (
              <div className="text-xs text-sky-700 bg-sky-50 p-3 rounded-2xl border border-sky-100 mb-4 font-medium">
                <strong>Image-to-Video:</strong> Requires exactly 1 image (starting phrase) or 2 images (start and end frames).
              </div>
            )}
            {activeTab === 'video' && videoGenerationType === 'ref2vid' && (
              <div className="text-xs text-sky-700 bg-sky-50 p-3 rounded-2xl border border-sky-100 mb-4 font-medium">
                <strong>Reference-to-Video:</strong> Requires exactly 3 reference images.
              </div>
            )}

            {/* Image Sources */}
            <div className="space-y-4">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Context Models</label>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <ImageIcon className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onPaste={handleUrlInputPaste}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                    placeholder="Paste image URL here..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-4 text-base focus:outline-none focus:border-[#0A2342] focus:ring-1 focus:ring-[#0A2342] transition-all placeholder:text-slate-400 text-slate-800"
                  />
                </div>
                <button
                  onClick={handleAddUrl}
                  disabled={images.length >= MAX_IMAGES}
                  className="bg-[#0A2342] text-white hover:bg-[#15345d] disabled:opacity-50 disabled:cursor-not-allowed px-6 py-4 rounded-2xl font-bold transition-all shadow-md active:scale-95 w-full sm:w-auto"
                >
                  Add
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Tip: copy an image (Snipping Tool, screenshot, browser) and paste it into the URL field.
              </p>

              <div className="relative">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  disabled={images.length >= MAX_IMAGES}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={images.length >= MAX_IMAGES}
                  className="w-full border-2 border-dashed border-slate-200 hover:border-[#0A2342]/50 bg-slate-50/50 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-[1.5rem] py-8 flex flex-col items-center justify-center gap-3 transition-all text-slate-500 hover:text-[#0A2342]"
                >
                  <Plus className="w-6 h-6" />
                  <span className="text-sm font-semibold">Upload from Device</span>
                </button>
              </div>

              {/* Thumbnails grid */}
              {images.length > 0 && (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-2 max-h-56 overflow-y-auto">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {images.map((img) => (
                      <div key={img.id} className="relative group rounded-xl border border-slate-200 bg-white shadow-sm p-1.5 min-h-24 flex items-center justify-center">
                        <img src={img.url} alt="Upload preview" className="w-full h-24 object-contain rounded-lg bg-slate-50" />
                      <button
                        onClick={() => removeImage(img.id)}
                          className="absolute top-1.5 right-1.5 bg-black/50 hover:bg-rose-500 text-white rounded-full p-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all backdrop-blur-sm"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      </div>
                  ))}
                  </div>
                </div>
              )}
            </div>

            {/* Generation Output Configuration - Conditional on Tab */}
            {activeTab === 'image' ? (
              <>
                {/* Prompt */}
                <div className="space-y-2 pt-2 text-left">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Setting & Context</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={2}
                    placeholder="Describe the new setting for your outfit..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-[#0A2342] focus:ring-1 focus:ring-[#0A2342] transition-all placeholder:text-slate-400 text-slate-800 resize-none shadow-sm"
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Wand2 className="w-4 h-4 text-sky-600" />
                      <span className="text-xs font-bold uppercase tracking-wider">Suggested Prompt Stack</span>
                    </div>
                    {isAnalyzingSuggestions && (
                      <span className="text-[11px] text-sky-600 font-semibold flex items-center gap-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Analyzing
                      </span>
                    )}
                  </div>

                  {suggestedBasePrompt ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setPrompt(suggestedBasePrompt)}
                        className="text-xs px-3 py-1.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 font-semibold"
                      >
                        Use Suggested Base Prompt
                      </button>
                      <pre className="text-xs leading-relaxed text-slate-700 font-mono bg-white border border-slate-200 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words">
                        {suggestedBasePrompt}
                      </pre>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Upload at least one image to auto-generate quality-preserving prompt suggestions.
                    </p>
                  )}
                </div>

                {/* Number of Outputs & Tweaks */}
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Output Variations</label>
                    <div className="flex bg-slate-100 rounded-full p-1 border border-slate-200 shadow-inner">
                      <button
                        onClick={() => setNumOutputs(2)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${numOutputs === 2 ? 'bg-white text-[#0A2342] shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        2 Layouts
                      </button>
                      <button
                        onClick={() => setNumOutputs(4)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${numOutputs === 4 ? 'bg-white text-[#0A2342] shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        4 Layouts
                      </button>
                    </div>
                  </div>
                  {suggestedVariationPrompts.length > 0 && (
                    <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] text-sky-700 font-medium">
                      Variation prompts are auto-suggested from your uploaded image and still fully editable below.
                    </div>
                  )}

                  {/* Distinct Pose Prompts */}
                  <div className="space-y-3 mt-2">
                    {Array.from({ length: numOutputs }).map((_, i) => (
                      <div key={i} className="flex flex-col gap-1 relative">
                        <span className="absolute left-4 top-3 text-[10px] font-bold text-sky-600 uppercase tracking-wider bg-slate-50 shadow-sm border border-slate-200 rounded-full px-2 py-0.5 z-10">Result {i + 1}</span>
                        <input
                          type="text"
                          value={posePrompts[i]}
                          onChange={(e) => {
                            const newPrompts = [...posePrompts];
                            newPrompts[i] = e.target.value;
                            setPosePrompts(newPrompts);
                          }}
                          placeholder={`Enter specific tweak...`}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-[80px] pr-5 py-4 text-base focus:outline-none focus:border-[#0A2342] transition-all placeholder:text-slate-400 text-slate-700 shadow-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Resolution & Aspect Ratio */}
                <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Resolution</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['1K', '2K', '4K'].map((res) => (
                        <button
                          key={res}
                          onClick={() => setResolution(res)}
                          className={`py-3 md:py-2.5 rounded-xl text-[13px] font-bold transition-all border ${resolution === res ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Aspect Ratio</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['auto', '1:1', '4:3', '3:4', '16:9', '9:16'].map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setAspectRatio(ratio)}
                          className={`py-3 md:py-2 px-1 rounded-xl text-xs font-bold transition-all border ${aspectRatio === ratio ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || images.length === 0}
                  className={`w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-2 transition-all shadow-[0_4px_14px_0_rgba(10,35,66,0.39)] hover:shadow-[0_6px_20px_rgba(10,35,66,0.23)] hover:bg-[#15345d] ${isGenerating || images.length === 0 ? 'bg-[#0A2342]/50 cursor-not-allowed shadow-none hover:shadow-none' : 'bg-[#0A2342] text-white active:scale-[0.98]'}`}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Designing Masterpiece...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Generate Masterpiece
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                {/* Type */}
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Generation Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => { setVideoGenerationType('img2vid'); setVideoModel('veo3'); }}
                      className={`py-4 md:py-3 rounded-2xl text-[15px] md:text-sm font-bold transition-all border ${videoGenerationType === 'img2vid' ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                    >
                      Frames to Video
                    </button>
                    <button
                      onClick={() => { setVideoGenerationType('ref2vid'); setVideoModel('veo3_fast'); }}
                      className={`py-4 md:py-3 rounded-2xl text-[15px] md:text-sm font-bold transition-all border ${videoGenerationType === 'ref2vid' ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                    >
                      Reference to Video
                    </button>
                  </div>
                </div>

                {/* Prompt */}
                <div className="space-y-2 mt-4">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Video Scene Prompt</label>
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    rows={3}
                    placeholder="Describe the motion, action, and scene..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-[#0A2342] focus:ring-1 focus:ring-[#0A2342] transition-all placeholder:text-slate-400 text-slate-800 resize-none shadow-sm"
                  />
                </div>

                {/* Model & Aspect Ratio */}
                <div className="grid grid-cols-2 gap-6 pt-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Veo Model</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setVideoModel('veo3')}
                        disabled={videoGenerationType === 'ref2vid'}
                        className={`py-3 md:py-2 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all border ${videoModel === 'veo3' ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white'}`}
                      >
                        Veo 3
                      </button>
                      <button
                        onClick={() => setVideoModel('veo3_fast')}
                        className={`py-3 md:py-2 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all border ${videoModel === 'veo3_fast' ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                      >
                        Veo 3 Fast
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Format</label>
                    <div className="grid grid-cols-2 gap-2">
                      {VIDEO_ASPECT_RATIOS.map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setVideoAspectRatio(ratio)}
                          className={`py-3 md:py-2 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all border ${videoAspectRatio === ratio ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Generate Button Videos */}
                <button
                  onClick={handleVideoGenerate}
                  disabled={isGenerating || images.length === 0}
                  className={`w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-2 transition-all shadow-[0_4px_14px_0_rgba(10,35,66,0.39)] hover:shadow-[0_6px_20px_rgba(10,35,66,0.23)] hover:bg-[#15345d] ${isGenerating || images.length === 0 ? 'bg-[#0A2342]/50 cursor-not-allowed shadow-none hover:shadow-none' : 'bg-[#0A2342] text-white active:scale-[0.98]'}`}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> Rendering Frame...
                    </>
                  ) : (
                    <>
                      <Video className="w-5 h-5" /> Animate Scene
                    </>
                  )}
                </button>
              </>
            )}

            {activeTab === 'image' && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-600" />
                    <h3 className="text-sm font-bold text-slate-700">Generation History</h3>
                  </div>
                  <button
                    onClick={clearHistory}
                    disabled={generationHistory.length === 0}
                    className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </button>
                </div>

                {generationHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    No history yet. Generated images will be saved on this device.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {generationHistory.map((entry) => {
                      const entryOutputs = Array.isArray(entry?.outputs) ? entry.outputs : [];
                      const firstOutputUrl = entryOutputs.length > 0 ? getResultImageUrl(entryOutputs[0]) : '';
                      return (
                        <article key={entry.id || `${entry.createdAt || 'time'}-${entry.prompt || 'prompt'}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[11px] text-slate-500 font-semibold">{formatHistoryDate(entry.createdAt)}</span>
                            <span className="text-[11px] font-bold text-rose-600">
                              {getTokenCostLabel(toNumberOrNull(entry.totalTokenUsed), entry.costMode || 'estimated')}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700 leading-snug">
                            {entry.prompt || 'Prompt unavailable'}
                          </p>
                          <div className="grid grid-cols-4 gap-2">
                            {entryOutputs.slice(0, 4).map((output, index) => {
                              const outputUrl = getResultImageUrl(output);
                              const outputCost = getResultImageCost(output);
                              const outputPrompt = getResultImagePrompt(output) || entry.prompt || '';
                              if (!outputUrl) return null;

                              return (
                                <div key={`${entry.id || 'entry'}-${index}`} className="space-y-1">
                                  <button
                                    onClick={() => handleRegenerateFromVariant(outputUrl)}
                                    className="relative w-full rounded-xl overflow-hidden border border-slate-200 bg-white hover:border-sky-300 transition-colors"
                                  >
                                    <img src={outputUrl} alt={`History output ${index + 1}`} className="w-full h-16 object-cover" />
                                    {Number.isFinite(outputCost) && (
                                      <span className="absolute bottom-1 left-1 right-1 bg-white/90 text-[10px] font-bold text-rose-600 rounded-md px-1 py-0.5 truncate">
                                        {getTokenCostLabel(outputCost, output?.tokenMode || entry.costMode || 'estimated')}
                                      </span>
                                    )}
                                  </button>
                                  {outputPrompt && (
                                    <pre
                                      className="text-[10px] font-mono text-slate-600 bg-white border border-slate-200 rounded-md px-1.5 py-1 whitespace-pre-wrap break-words overflow-hidden"
                                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                                    >
                                      {outputPrompt}
                                    </pre>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleOpenHistoryEntry(entry)}
                              className="text-xs px-3 py-2 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                            >
                              Open Result
                            </button>
                            <button
                              onClick={() => firstOutputUrl && handleRegenerateFromVariant(firstOutputUrl)}
                              disabled={!firstOutputUrl}
                              className="text-xs px-3 py-2 rounded-full border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Use First as Base
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="p-4 mt-6 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-600 text-sm shadow-sm font-medium">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {/* Task state info */}
            {taskState && !error && (
              <p className="text-xs font-bold text-center text-[#0A2342] mt-4 animate-pulse pt-2 border-t border-slate-100">{taskState}</p>
            )}

          </div>
        </div>

        {/* Right Column - Results */}
        <div className={`${mobileView === 'preview' ? 'flex' : 'hidden'} lg:flex lg:col-span-7 xl:col-span-8 flex-col min-h-[60vh] lg:min-h-[calc(100vh-8rem)]`}>
          <div className="relative flex-1 rounded-[1.5rem] sm:rounded-[2.5rem] bg-white border border-slate-200 shadow-[0_8px_40px_rgb(0,0,0,0.06)] flex items-center justify-center p-3 sm:p-8">

            {/* Empty State / Initial Image Previews */}
            {images.length === 0 && !isGenerating && !currentResultValid && (
              <div className="text-center p-8 max-w-sm mx-auto flex flex-col items-center justify-center h-full">
                <div className="w-24 h-24 mb-6 rounded-full bg-slate-50 flex items-center justify-center border-4 border-white shadow-md">
                  <Wand2 className="w-10 h-10 text-slate-300" />
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">Your Canvas is Ready</h3>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">
                  Upload an outfit image, describe your creative vision, and let the AI craft a studio-grade scene tailored perfectly.
                </p>
              </div>
            )}

            {images.length > 0 && !currentResultValid && !isGenerating && (
              <div className="absolute inset-0 p-3 sm:p-6 flex flex-col bg-slate-50/60">
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 w-full">
                  {images.map((img, i) => (
                    <div
                      key={img.id}
                        className="relative rounded-[1.5rem] overflow-hidden shadow-sm border border-slate-200 bg-white p-3 min-h-[180px] flex items-center justify-center transition-all duration-300 hover:border-sky-300 hover:shadow-md"
                    >
                      <img
                        src={img.url}
                        alt={`Preview ${i + 1}`}
                          className="w-full h-full max-h-[46vh] object-contain rounded-2xl bg-slate-50"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>';
                        }}
                      />

                      {i === 0 && (
                        <div className="absolute top-4 left-4 z-20 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full text-xs font-black text-[#0A2342] shadow-sm border border-white/50 flex items-center gap-1.5 uppercase tracking-wider">
                          <Sparkles className="w-4 h-4 text-sky-500" /> Primary
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                </div>
                <div className="pt-3 sm:pt-4 flex justify-center">
                  <div className="bg-white/90 backdrop-blur-md px-5 py-2.5 rounded-full text-sm font-bold text-slate-700 border border-slate-200 shadow-sm flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-sky-500" />
                    {images.length} Image{images.length > 1 ? 's' : ''} Uploaded & Ready
                  </div>
                </div>
              </div>
            )}

            {/* Loading State Overlay */}
            {isGenerating && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/90 backdrop-blur-3xl transition-opacity duration-1000">
                {/* Visual feedback behind the spinner */}
                {images.length > 0 && (
                  <div
                    className="absolute inset-0 opacity-10 scale-110 saturate-[0.2]"
                    style={{
                      backgroundImage: `url(${images[0].url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      filter: 'blur(30px)',
                      transition: 'all 20s ease-in-out',
                    }}
                  />
                )}

                <div className="relative z-40 flex flex-col items-center p-8 sm:p-12 bg-white/50 rounded-[2rem] sm:rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl border border-white">
                  {/* Timer UI */}
                  <div className="text-[#0A2342] font-mono text-4xl sm:text-6xl font-black tracking-tighter mb-6 sm:mb-8 drop-shadow-sm">
                    {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                  </div>

                  <div className="relative w-20 h-20 sm:w-28 sm:h-28 mb-6 sm:mb-8 shadow-inner rounded-full bg-slate-50/50">
                    <div className="absolute inset-0 border-t-4 border-[#0A2342] rounded-full animate-spin"></div>
                    <div className="absolute inset-3 border-r-4 border-sky-400 rounded-full animate-spin animation-delay-150"></div>
                    <div className="absolute inset-6 border-b-4 border-slate-200 rounded-full animate-spin animation-delay-300"></div>
                    <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-sky-500 animate-pulse" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Crafting Magic...</h3>
                  <p className="text-xs sm:text-sm text-sky-600 font-bold animate-pulse max-w-[90%] sm:max-w-[80%] text-center tracking-wider uppercase">{taskState}</p>
                  <button
                    onClick={() => {
                      generationControllerRef.current?.abort();
                      setTaskState('Cancelling generation...');
                    }}
                    className="mt-6 px-5 py-2 rounded-full border border-slate-300 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {currentResultValid && !isGenerating && (
              <div className="absolute inset-0 p-3 sm:p-4 transition-all duration-500 flex flex-col">
                <div className="absolute top-3 sm:top-6 left-3 sm:left-6 right-3 sm:right-6 z-40 flex justify-between items-start pointer-events-none flex-col sm:flex-row gap-2 sm:gap-0">
                  <button
                    onClick={() => {
                      setResultImages(null);
                      setSelectedResult(null);
                      setVideoResultUrl(null);
                      setMobileView('controls');
                    }}
                    className="pointer-events-auto bg-white/90 hover:bg-slate-50 text-slate-800 px-5 py-2.5 rounded-full border border-slate-200 text-sm font-bold backdrop-blur-md shadow-lg transition-all"
                  >
                    {'<-'} Go Back
                  </button>
                  <div className="pointer-events-auto bg-amber-50 border border-amber-200 backdrop-blur-md rounded-full px-4 py-2 flex items-center gap-2 text-xs font-bold text-amber-700 shadow-lg max-w-full sm:max-w-md">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                    Save results before leaving! Changes will be lost.
                  </div>
                </div>
                <div className="flex-1 w-full h-full relative flex items-center justify-center p-4">
                  {activeTab === 'image' && resultImages && (
                    selectedResult !== null ? (
                      <div className="w-full h-full relative group">
                        <button
                          onClick={() => setSelectedResult(null)}
                          className="absolute top-6 right-6 z-40 bg-white/90 hover:bg-slate-50 text-slate-800 px-5 py-2.5 rounded-full border border-slate-200 text-sm font-bold backdrop-blur-md shadow-lg transition-all"
                        >
                          <X className="w-4 h-4 inline-block mr-1" /> Close
                        </button>
                        <div className="w-full h-full bg-slate-50 rounded-[2rem] border border-slate-200 overflow-hidden shadow-inner p-2 flex items-center justify-center">
                          <img
                            src={getResultImageUrl(resultImages[selectedResult])}
                            alt="Selected Result"
                            className="max-w-full max-h-full object-contain rounded-2xl shadow-xl transition-all duration-500"
                          />
                        </div>
                        {Number.isFinite(getResultImageCost(resultImages[selectedResult])) && (
                          <p className="mt-3 text-center text-sm font-bold text-rose-600">
                            {getTokenCostLabel(getResultImageCost(resultImages[selectedResult]), resultImages[selectedResult]?.tokenMode || 'estimated')}
                          </p>
                        )}
                        {getResultImagePrompt(resultImages[selectedResult]) && (
                          <div className="mt-3 mx-auto max-w-4xl bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Prompt Used</p>
                            <pre className="text-xs leading-relaxed font-mono text-slate-700 whitespace-pre-wrap break-words">
                              {getResultImagePrompt(resultImages[selectedResult])}
                            </pre>
                          </div>
                        )}
                        <div className="absolute bottom-4 sm:bottom-10 left-0 right-0 flex flex-wrap justify-center gap-3 sm:gap-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 px-3 sm:px-4">
                          <button
                            onClick={() => handleEnhanceTo4K(getResultImageUrl(resultImages[selectedResult]))}
                            className="bg-[#0A2342] hover:bg-[#15345d] text-white px-6 py-3.5 rounded-full font-bold flex items-center gap-2 shadow-xl transition-all hover:scale-105"
                          >
                            <Sparkles className="w-4 h-4 text-sky-300" />
                            Enhance to 4K
                          </button>

                          <a
                            href={getResultImageUrl(resultImages[selectedResult])}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 px-6 py-3.5 rounded-full font-bold flex items-center gap-2 shadow-xl transition-all hover:scale-105"
                          >
                            <Download className="w-4 h-4" />
                            Save Image
                          </a>

                          <button
                            onClick={() => handleRegenerateFromVariant(getResultImageUrl(resultImages[selectedResult]))}
                            className="bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 px-6 py-3.5 rounded-full font-bold flex items-center gap-2 shadow-xl transition-all hover:scale-105"
                          >
                            <LayoutTemplate className="w-4 h-4" />
                            Use as New Base
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col pt-16 sm:pt-20">
                        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-5 sm:mb-6 text-center tracking-tight">Select your preferred layout</h2>
                        <div className={`grid ${resultImages.length === 2 ? 'grid-cols-1 sm:grid-cols-2 max-w-3xl mx-auto' : 'grid-cols-1 sm:grid-cols-2'} gap-4 sm:gap-6 w-full flex-1 px-2 sm:px-10 pb-4 sm:pb-6 overflow-y-auto`}>
                          {resultImages.map((resultItem, idx) => {
                            const resultCost = getResultImageCost(resultItem);
                            const resultPrompt = getResultImagePrompt(resultItem);

                            return (
                              <div key={idx} className="relative group/item rounded-[2rem] overflow-hidden border-4 border-white bg-slate-50 cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-sky-300 transition-all flex items-center justify-center h-full" onClick={() => setSelectedResult(idx)}>
                                <img
                                  src={getResultImageUrl(resultItem)}
                                  alt={`Result Variant ${idx + 1}`}
                                  className="max-w-full max-h-[90%] object-contain opacity-100 group-hover/item:scale-[1.02] transition-all duration-500 rounded-xl"
                                />
                                {(Number.isFinite(resultCost) || resultPrompt) && (
                                  <div className="absolute bottom-3 left-3 right-3 bg-white/90 rounded-lg px-2 py-1.5 border border-slate-200">
                                    {Number.isFinite(resultCost) && (
                                      <p className="text-[11px] font-bold text-rose-600 text-center">
                                        {getTokenCostLabel(resultCost, resultItem?.tokenMode || 'estimated')}
                                      </p>
                                    )}
                                    {resultPrompt && (
                                      <pre
                                        className="mt-1 text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-words overflow-hidden"
                                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                                      >
                                        {resultPrompt}
                                      </pre>
                                    )}
                                  </div>
                                )}
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity">
                                  <div className="bg-[#0A2342] text-white px-6 py-3 rounded-full font-bold shadow-[0_8px_30px_rgb(0,0,0,0.2)] flex items-center gap-2 transform translate-y-4 group-hover/item:translate-y-0 transition-all hover:bg-[#15345d]">
                                    <Sparkles className="w-4 h-4 text-sky-300" />
                                    View Result
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex justify-center mt-2 mb-8">
                          <button
                            onClick={handleGenerate}
                            className="bg-white hover:bg-slate-50 text-slate-800 px-8 py-4 rounded-full font-black flex items-center gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all hover:scale-105 border border-slate-200"
                          >
                            <Sparkles className="w-5 h-5 text-sky-500" />
                            Regenerate Options
                          </button>
                        </div>
                      </div>
                    )
                  )}

                  {activeTab === 'video' && videoResultUrl && (
                    <div className="w-full h-full relative group flex items-center justify-center p-4">
                      <div className="w-full max-w-4xl max-h-full bg-slate-50 rounded-[2.5rem] p-3 border border-slate-200 shadow-2xl">
                        <video
                          src={videoResultUrl}
                          controls
                          autoPlay
                          loop
                          muted
                          className="w-full h-full object-contain rounded-[2rem]"
                        />
                      </div>
                      <div className="absolute bottom-4 sm:bottom-10 left-0 right-0 flex justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 px-4">
                        <a
                          href={videoResultUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-white/90 hover:bg-white text-slate-800 backdrop-blur-md border border-slate-200 px-8 py-4 rounded-full font-black flex items-center gap-2 shadow-xl transition-all hover:scale-105"
                        >
                          <Download className="w-5 h-5" />
                          Save Video Animation
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-50 lg:hidden border-t border-slate-200 bg-white/95 backdrop-blur-md px-4 py-3">
        <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
          <button
            onClick={() => setMobileView('controls')}
            className={`rounded-2xl py-3 px-4 text-sm font-bold flex items-center justify-center gap-2 transition-all ${mobileView === 'controls' ? 'bg-[#0A2342] text-white shadow-md' : 'bg-slate-100 text-slate-600'}`}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={() => setMobileView('preview')}
            className={`rounded-2xl py-3 px-4 text-sm font-bold flex items-center justify-center gap-2 transition-all ${mobileView === 'preview' ? 'bg-[#0A2342] text-white shadow-md' : 'bg-slate-100 text-slate-600'}`}
          >
            <ImageIcon className="w-4 h-4" />
            Preview
          </button>
        </div>
      </nav>
    </div>
  );
}

export default App;
