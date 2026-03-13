import { useState, useRef, useEffect } from 'react';
import { Settings, Image as ImageIcon, Sparkles, Download, Loader2, Plus, X, AlertCircle, Video, LayoutTemplate, Wand2, History, Trash2, Clock3, Check, Eye } from 'lucide-react';
import { createTask, pollTaskStatus, checkConnection } from './services/nanoBananaApi';
import { createVideoTask, pollVideoStatus } from './services/veoApi';
import { uploadImageToHost } from './services/imgbbApi';
import { generatePromptsWithGpt52 } from './services/gpt5Api';

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
const MAX_IMAGES = 14;
const MAX_HISTORY_ITEMS = 50;
const HISTORY_STORAGE_KEY = 'outfit_ai_generation_history_v1';
const REROLL_PREFERRED_GUIDANCE = 'Use the first reference image as the preferred direction. Preserve outfit identity, styling language, and framing intent while creating fresh alternatives.';
const API_KEY_STORAGE_KEY = 'outfit_ai_api_key_v1';

// (Removed old local canvas analyzer)
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
  const [mainTab, setMainTab] = useState('home'); // 'home', 'history', 'settings'
  const [activeTab, setActiveTab] = useState('image'); // 'image' or 'video'
  const [mobileView, setMobileView] = useState('controls'); // 'controls' or 'preview'

  // Image Gen State
  const [images, setImages] = useState([]);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef(null);

  const [prompt, setPrompt] = useState(DEFAULT_IMAGE_PROMPT);
  const [numOutputs, setNumOutputs] = useState(4);
  const [resolution, setResolution] = useState('1K');
  const [aspectRatio, setAspectRatio] = useState('auto');
  
  // GPT-5.2 Analyzer State
  const [isAnalyzingSuggestions, setIsAnalyzingSuggestions] = useState(false);

  // Video Gen State
  const [videoPrompt, setVideoPrompt] = useState('A cinematic slow-motion pan showcasing the stunning fabric textures, natural lighting');
  const [videoGenerationType, setVideoGenerationType] = useState('img2vid'); // 'text2vid', 'img2vid', or 'ref2vid'
  const [videoModel, setVideoModel] = useState('veo3_fast');
  const [videoAspectRatio, setVideoAspectRatio] = useState('16:9');
  const [videoResultUrl, setVideoResultUrl] = useState(null);

  // Common State
  const [isGenerating, setIsGenerating] = useState(false);
  const [taskState, setTaskState] = useState('');
  const [resultImages, setResultImages] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [selectedResultIndices, setSelectedResultIndices] = useState(new Set());
  const [preferredResultIndex, setPreferredResultIndex] = useState(null);
  const [error, setError] = useState(null);
  const [generationHistory, setGenerationHistory] = useState([]);
  const currentResultValid = activeTab === 'image' ? (resultImages && resultImages.length > 0) : videoResultUrl;
  const [enlargedImage, setEnlargedImage] = useState(null);

  // Timer state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loadingBlendPercent, setLoadingBlendPercent] = useState(0);
  const [loadingBlendIndex, setLoadingBlendIndex] = useState(0);
  const [imageGenerationTimes, setImageGenerationTimes] = useState([]);

  const MAX_FILE_SIZE_MB = 50;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
  const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', 'Auto'];
  const generationControllerRef = useRef(null);
  const taskStateClearTimeoutRef = useRef(null);

  const buildId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const toNumberOrNull = (value) => {
    if (typeof value !== 'number') return null;
    if (!Number.isFinite(value)) return null;
    return value;
  };

  const parseCreditValue = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
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
    generationSeconds: toNumberOrNull(metadata?.generationSeconds),
    createdAt: new Date().toISOString(),
  });

  const getResultImagePrompt = (resultItem) => {
    if (!resultItem || typeof resultItem === 'string') return '';
    return typeof resultItem.promptUsed === 'string' ? resultItem.promptUsed : '';
  };

  const getResultImageGenerationSeconds = (resultItem) => {
    if (!resultItem || typeof resultItem === 'string') return null;
    return toNumberOrNull(resultItem.generationSeconds);
  };

  const splitCostAcrossImages = (totalCost, count) => {
    if (!Number.isFinite(totalCost) || count <= 0) return Array(count).fill(null);
    const perImage = Number((totalCost / count).toFixed(2));
    return Array(count).fill(perImage);
  };

  const getPreferredResultItem = (sourceResults = resultImages, preferredIndex = preferredResultIndex) => {
    if (!Array.isArray(sourceResults) || sourceResults.length === 0) return null;
    if (!Number.isInteger(preferredIndex)) return null;
    if (preferredIndex < 0 || preferredIndex >= sourceResults.length) return null;
    return sourceResults[preferredIndex] || null;
  };

  const buildGenerationSourceImages = (preferredImageUrl = '') => {
    if (!preferredImageUrl) return images;
    const deduped = images.filter((img) => img.url !== preferredImageUrl);
    return [{ id: buildId('preferred'), url: preferredImageUrl, isLocal: false }, ...deduped].slice(0, MAX_IMAGES);
  };

  const importImagesToVeoMode = (urls, successLabel = 'Image imported to Veo 3.1 mode.') => {
    const safeUrls = Array.isArray(urls)
      ? urls.map((url) => (typeof url === 'string' ? url.trim() : '')).filter(Boolean)
      : [];

    if (!safeUrls.length) {
      setError('No image is available to import.');
      return;
    }

    const existingUrls = new Set(images.map((img) => img.url));
    const nextImages = [...images];
    let added = 0;
    let duplicates = 0;

    for (const url of safeUrls) {
      if (existingUrls.has(url)) {
        duplicates += 1;
        continue;
      }
      if (nextImages.length >= MAX_IMAGES) break;
      nextImages.push({ id: Date.now() + Math.random() + added, url, isLocal: false });
      existingUrls.add(url);
      added += 1;
    }

    if (added === 0) {
      if (nextImages.length >= MAX_IMAGES) {
        setError(`Image limit reached (${MAX_IMAGES}). Remove one before importing to Veo 3.1.`);
      } else {
        setError('That image is already in your context list.');
      }
      return;
    }

    setImages(nextImages);
    setActiveTab('video');
    setMobileView('controls');
    setVideoResultUrl(null);
    setError(null);
    setTaskState(duplicates > 0 ? `${successLabel} ${duplicates} duplicate image(s) were skipped.` : successLabel);
    scheduleTaskStateReset(2400);
  };

  const getTokenCostLabel = (tokenCost, mode = 'estimated') => {
    if (!Number.isFinite(tokenCost)) {
      return 'Cost unavailable';
    }
    const formatted = Number.isInteger(tokenCost) ? tokenCost.toString() : tokenCost.toFixed(2);
    if (mode === 'estimated') return `-${formatted} tokens (est.)`;
    return `-${formatted} tokens`;
  };

  const formatElapsedClock = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

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
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    return /cancelled by user/i.test(err.message ?? '');
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
    if (!isGenerating || images.length === 0) {
      setLoadingBlendPercent(0);
      setLoadingBlendIndex(0);
      return;
    }

    let isCancelled = false;
    let blendPercent = 0;
    let blendIndex = 0;
    const tickMs = 120;
    const stepPercent = 2;

    setLoadingBlendPercent(0);
    setLoadingBlendIndex(0);

    const intervalId = setInterval(() => {
      if (isCancelled) return;

      blendPercent += stepPercent;
      if (blendPercent > 100) blendPercent = 100;
      setLoadingBlendPercent(blendPercent);

      if (blendPercent >= 100) {
        blendIndex = (blendIndex + 1) % images.length;
        blendPercent = 0;
        setLoadingBlendIndex(blendIndex);
        setLoadingBlendPercent(0);
      }
    }, tickMs);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [isGenerating, images.length]);

  useEffect(() => {
    try {
      const normalizedApiKey = apiKey.trim();
      if (!normalizedApiKey) {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        setConnectionStatus('idle');
        return;
      }
      localStorage.setItem(API_KEY_STORAGE_KEY, normalizedApiKey);
    } catch (storageError) {
      console.error('Failed to persist API key:', storageError);
    }
  }, [apiKey]);

  // Auto-connect
  useEffect(() => {
    const key = apiKey.trim();
    if (key && key.length > 10 && connectionStatus === 'idle' && !isTestingConnection) {
      const timer = setTimeout(() => {
        handleTestConnection();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [apiKey, connectionStatus, isTestingConnection]);

  // Real-time token tracking
  useEffect(() => {
    let intervalId;
    if (apiKey && connectionStatus === 'success') {
      intervalId = setInterval(() => {
        refreshCredits(apiKey);
      }, 5000); // Poll every 5 seconds for "real-time" tracking
    }
    return () => clearInterval(intervalId);
  }, [apiKey, connectionStatus]);

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

  const handleAnalyzePrompt = async () => {
    if (images.length === 0) {
      setError('Please upload at least one image before analyzing.');
      return;
    }
    
    const key = apiKey.trim();
    if (!key) {
      setError('Please enter and sync your Kie.ai API key to use the AI Analyzer.');
      return;
    }

    setIsAnalyzingSuggestions(true);
    let analysisFailed = false;

    try {
      const hostedImageUrls = await Promise.all(
        images.map(async (img) => {
          if (img.isLocal || img.url.startsWith('data:')) {
            return await uploadImageToHost(img.url);
          }
          return img.url;
        })
      );

      const result = await generatePromptsWithGpt52(key, hostedImageUrls, { requestTimeoutMs: 60000 });
      setPrompt(result.basePrompt || FALLBACK_SUGGESTED_BASE_PROMPT);
      setTaskState('GPT-5.2 successfully analyzed your images!');
      scheduleTaskStateReset(3000);
    } catch (analysisError) {
      console.error('Failed to analyze uploaded images via GPT-5-2:', analysisError);
      setError(analysisError.message || 'Analysis failed. Make sure your API key has GPT-5-2 access.');
      analysisFailed = true;
    } finally {
      setIsAnalyzingSuggestions(false);
    }
  };

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

  const handleGenerate = async (options = {}) => {
    if (isGenerating) return;
    const rerollFromPreferred = Boolean(options?.rerollFromPreferred);
    const preferredItem = rerollFromPreferred ? getPreferredResultItem() : null;
    const preferredImageUrl = preferredItem ? getResultImageUrl(preferredItem) : '';

    if (rerollFromPreferred && !preferredImageUrl) {
      setError('Choose a preferred layout before rerolling.');
      return;
    }

    const sourceImages = buildGenerationSourceImages(preferredImageUrl);

    setError(null);
    setResultImages(null);
    setSelectedResult(null);
    setPreferredResultIndex(null);
    setImageGenerationTimes([]);
    clearPendingTaskStateReset();

    const key = apiKey.trim();
    if (!key) {
      setError('Please enter your kie.ai API key to begin.');
      return;
    }

    if (sourceImages.length === 0) {
      setError('Please provide at least one source image.');
      return;
    }

    const controller = createGenerationController();
    let generationFailed = false;
    let creditsBefore = toNumberOrNull(credits);
    let creditsAfter = null;

    try {
      setIsGenerating(true);
      setTaskState(rerollFromPreferred ? 'Rerolling from your preferred layout...' : 'Preparing images...');

      if (creditsBefore === null) {
        try {
          creditsBefore = await checkConnection(key, { signal: controller.signal });
          setCredits(creditsBefore);
        } catch {
          creditsBefore = null;
        }
      }

      const imageUrls = [];
      for (const img of sourceImages) {
        if (img.isLocal || img.url.startsWith('data:')) {
          setTaskState('Uploading local image to secure host...');
          const remoteUrl = await uploadImageToHost(img.url, { signal: controller.signal });
          imageUrls.push(remoteUrl);
        } else {
          imageUrls.push(img.url);
        }
      }

      setTaskState(rerollFromPreferred
        ? `Initiating ${numOutputs} reroll tasks from preferred layout...`
        : `Initiating ${numOutputs} parallel AI synthesis tasks...`);
      setImageGenerationTimes(Array.from({ length: numOutputs }, () => ({ seconds: null, done: false })));

      const basePrompt = (prompt || '').trim() || DEFAULT_IMAGE_PROMPT;
      const fullPrompts = Array.from({ length: numOutputs }).map(() => {
        const sections = rerollFromPreferred
          ? [basePrompt, REROLL_PREFERRED_GUIDANCE]
          : [basePrompt];
        return sections.filter(Boolean).join('. ');
      });

      const taskIds = await Promise.all(
        fullPrompts.map((fullPrompt) =>
          createTask(key, fullPrompt, imageUrls, resolution, aspectRatio, {
            signal: controller.signal,
          })
        )
      );

      setTaskState('Tasks created. Waiting for AI generation (this may take a minute)...');

      let completedTasks = 0;
      const generationStartedAt = Date.now();

      const finalImages = await Promise.all(
        taskIds.map(async (taskId, index) => {
          const imageUrl = await pollTaskStatus(key, taskId, null, {
            signal: controller.signal,
          });
          const seconds = Math.max(1, Math.round((Date.now() - generationStartedAt) / 1000));
          setImageGenerationTimes((previous) => {
            if (!Array.isArray(previous) || previous.length === 0) return previous;
            const next = [...previous];
            next[index] = { seconds, done: true };
            return next;
          });
          completedTasks += 1;
          setTaskState(`Generation progress: ${completedTasks}/${numOutputs} complete...`);
          return {
            imageUrl,
            generationSeconds: seconds,
          };
        })
      );

      creditsAfter = await refreshCredits(key, controller.signal);
      const totalTokenUsed = (Number.isFinite(creditsBefore) && Number.isFinite(creditsAfter))
        ? Math.max(0, Number((creditsBefore - creditsAfter).toFixed(2)))
        : null;
      const costSplit = splitCostAcrossImages(totalTokenUsed, finalImages.length);
      const enrichedResults = finalImages.map((resultItem, index) =>
        createResultImage(resultItem.imageUrl, costSplit[index], 'estimated', {
          promptUsed: fullPrompts[index] || basePrompt,
          generationSeconds: resultItem.generationSeconds,
        })
      );

      setResultImages(enrichedResults);
      setTaskState('');
      setMobileView('preview');

      appendHistoryEntry({
        id: buildId('hist'),
        createdAt: new Date().toISOString(),
        prompt: basePrompt,
        sourceCount: sourceImages.length,
        resolution,
        aspectRatio,
        totalTokenUsed,
        costMode: Number.isFinite(totalTokenUsed) ? 'estimated' : 'unknown',
        outputs: enrichedResults,
        generationMode: rerollFromPreferred ? 'reroll' : 'fresh',
        preferredSourceUrl: preferredImageUrl || null,
      });
    } catch (err) {
      generationFailed = true;
      setImageGenerationTimes([]);
      setError(isAbortError(err) ? 'Generation cancelled.' : (err.message || 'An error occurred during generation.'));
    } finally {
      finalizeGeneration(controller);
      if (!generationFailed && !Number.isFinite(creditsAfter)) {
        await refreshCredits(key);
      }
    }
  };

  const handleVideoGenerate = async () => {
    if (isGenerating) return;
    clearPendingTaskStateReset();
    setImageGenerationTimes([]);
    const key = apiKey.trim();
    if (!key) {
      setError('Please enter your kie.ai API key to begin.');
      return;
    }

    // Constraints check
    if (videoGenerationType === 'img2vid') {
      if (images.length < 1 || images.length > 2) {
        setError('Image-to-Video requires 1 or 2 images (First & Last Frame).');
        return;
      }
    } else if (videoGenerationType === 'ref2vid') {
      if (images.length < 1 || images.length > 3) {
        setError('Reference-to-Video requires 1 to 3 images.');
        return;
      }
    }
    // text2vid: no image constraint

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

      const apiGenType =
        videoGenerationType === 'img2vid' ? 'FIRST_AND_LAST_FRAMES_2_VIDEO' :
        videoGenerationType === 'ref2vid' ? 'REFERENCE_2_VIDEO' :
        'TEXT_2_VIDEO';
      const actualModel = videoGenerationType === 'ref2vid' ? 'veo3_fast' : videoModel; // ref2vid forces fast model

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
    setImageGenerationTimes([]);
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
    // Append this specific image to the upload queue as a new base image
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) return prev;
      return [...prev, { id: Date.now(), url: imageUrl, isLocal: false }];
    });
    setResultImages(null);
    setSelectedResult(null);
    setPreferredResultIndex(null);
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
          generationSeconds: getResultImageGenerationSeconds(item),
        });
      })
      .filter(Boolean);

    if (!hydrated.length) return;

    setActiveTab('image');
    setVideoResultUrl(null);
    setSelectedResult(null);
    setPreferredResultIndex(null);
    setResultImages(hydrated);
    if (typeof entry?.prompt === 'string' && entry.prompt.trim()) {
      setPrompt(entry.prompt);
    }
    setMobileView('preview');
  };

  const handleSetPreferredResult = (index) => {
    if (!Array.isArray(resultImages) || index < 0 || index >= resultImages.length) return;
    setPreferredResultIndex(index);
    setError(null);
    setTaskState(`Preferred layout set to Result ${index + 1}.`);
    scheduleTaskStateReset(2000);
  };

  const handleRerollFromPreferred = () => {
    if (!Number.isInteger(preferredResultIndex)) {
      setError('Select a preferred layout first, then reroll.');
      return;
    }
    handleGenerate({ rerollFromPreferred: true });
  };

  const handleImportSelectedResultToVeo = (resultItem) => {
    const imageUrl = getResultImageUrl(resultItem);
    if (!imageUrl) {
      setError('Unable to import this result because no image URL was found.');
      return;
    }
    importImagesToVeoMode([imageUrl], 'Image imported to Veo 3.1 mode.');
  };

  const handleImportPreferredToVeo = () => {
    const preferredItem = getPreferredResultItem();
    if (!preferredItem) {
      setError('Select a preferred layout before importing to Veo 3.1.');
      return;
    }
    handleImportSelectedResultToVeo(preferredItem);
  };

  const hasLoadingBlendImages = images.length > 0;
  const loadingCurrentImageUrl = hasLoadingBlendImages
    ? images[loadingBlendIndex % images.length]?.url
    : '';
  const loadingBlendRatio = Math.min(Math.max(loadingBlendPercent / 100, 0), 1);
  const loadingOutputCount = activeTab === 'image'
    ? Math.max(1, imageGenerationTimes.length || numOutputs)
    : 0;
  const loadingImageCards = activeTab === 'image'
    ? Array.from({ length: loadingOutputCount }, (_, index) => {
      const sourceImage = images[index % images.length];
      const timing = imageGenerationTimes[index];
      const done = Boolean(timing?.done);
      const seconds = done && Number.isFinite(timing?.seconds) ? timing.seconds : elapsedSeconds;
      return {
        id: `loading-card-${index}`,
        index,
        imageUrl: sourceImage?.url || loadingCurrentImageUrl || '',
        done,
        seconds: Math.max(0, seconds),
      };
    })
    : [];
  const normalizedCredits = parseCreditValue(credits);
  const hasLowBalance = normalizedCredits !== null && normalizedCredits <= 0;
  const hasConnectionError = connectionStatus === 'error';
  const hasPreferredResult = Number.isInteger(preferredResultIndex)
    && Array.isArray(resultImages)
    && preferredResultIndex >= 0
    && preferredResultIndex < resultImages.length;
  const selectedResultItem = Number.isInteger(selectedResult)
    && Array.isArray(resultImages)
    && selectedResult >= 0
    && selectedResult < resultImages.length
    ? resultImages[selectedResult]
    : null;

  return (
    <div className="mejin-app min-h-screen font-sans pb-28" style={{background:'var(--bg-base)'}}>
      {/* Header */}
      <header className="mejin-header">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="mejin-logo-badge" aria-hidden="true">
              <span className="mejin-logo-glyph">M</span>
            </div>
            <div className="mejin-wordmark" role="img" aria-label="Mejin">
              <span className="mejin-wordmark-title">Mejin</span>
              <span className="mejin-wordmark-subtitle" style={{ color: 'var(--mejin-text-soft)' }}>Image Craft Studio</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-sm font-medium">
            <div className="mejin-segment-shell rounded-full p-1 flex items-center">
              <button
                onClick={() => {
                  setActiveTab('image');
                  setMainTab('home');
                  setMobileView('controls');
                }}
                className={`mejin-segment-btn px-3 sm:px-6 py-2.5 rounded-full transition-all flex items-center gap-1.5 sm:gap-2 font-medium text-xs sm:text-sm ${activeTab === 'image' ? 'mejin-segment-btn--active' : 'mejin-segment-btn--idle'}`}
              >
                <ImageIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Outfit Image</span>
                <span className="sm:hidden">Image</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('video');
                  setMainTab('home');
                  setMobileView('controls');
                }}
                className={`mejin-segment-btn px-3 sm:px-6 py-2.5 rounded-full transition-all flex items-center gap-1.5 sm:gap-2 font-medium text-xs sm:text-sm ${activeTab === 'video' ? 'mejin-segment-btn--active' : 'mejin-segment-btn--idle'}`}
              >
                <Video className="w-4 h-4" />
                <span className="hidden sm:inline">Veo 3.1 Video</span>
                <span className="sm:hidden">Video</span>
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="w-full max-w-xl mx-auto px-4 pt-6 pb-32 flex flex-col gap-4">

        {mainTab === 'home' && (
          <div className="w-full flex flex-col gap-4">
            {/* Hero */}
            <div className="text-center pt-2 pb-1">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-3" style={{background:'var(--primary-soft)',border:'1px solid rgba(37,99,235,0.15)'}}>
                <Sparkles className="w-3 h-3" style={{color:'var(--primary)'}} />
                <span className="text-xs font-700" style={{color:'var(--primary)',fontWeight:700}}>AI-Powered Generation</span>
              </div>
              <h1 className="font-serif font-black tracking-tight leading-tight mb-2" style={{fontFamily:'Outfit,Inter,sans-serif',fontSize:'clamp(1.75rem,6vw,2.5rem)',color:'var(--text)'}}>
                Image Craft <span className="gradient-text">Studio</span>
              </h1>
              <p className="text-sm mx-auto max-w-xs" style={{color:'var(--text-secondary)'}}>
                Upload photos · Write a prompt · Generate stunning AI images
              </p>
            </div>

          {/* Video type info banners */}
          {activeTab === 'video' && videoGenerationType === 'text2vid' && (
            <div className="mejin-alert mejin-alert--info">
              <Video className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Text-to-Video:</strong> No images needed — describe the scene and Veo 3.1 will generate it from scratch.</span>
            </div>
          )}
          {activeTab === 'video' && videoGenerationType === 'img2vid' && (
            <div className="mejin-alert mejin-alert--info">
              <Video className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Image-to-Video:</strong> Requires 1 image (start frame) or 2 images (start &amp; end frames).</span>
            </div>
          )}
          {activeTab === 'video' && videoGenerationType === 'ref2vid' && (
            <div className="mejin-alert mejin-alert--info">
              <Video className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Reference-to-Video:</strong> Requires 1 to 3 reference images. Fast model only.</span>
            </div>
          )}
          {activeTab === 'video' && Array.isArray(resultImages) && resultImages.length > 0 && (
            <div className="mejin-alert mejin-alert--info" style={{justifyContent:'space-between',flexWrap:'wrap',gap:'8px'}}>
              <span style={{fontSize:'0.8125rem'}}>Have generated layouts? Import your preferred one into Veo 3.1.</span>
                <button
                  onClick={handleImportPreferredToVeo}
                  disabled={!hasPreferredResult}
                  className="mejin-btn-primary text-xs px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import Preferred
                </button>
              </div>
            )}

          {/* Main Upload Card */}
          <div className="mejin-panel p-5 flex flex-col gap-5">
            {/* Image Sources */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="section-label">Upload Images</span>
                <span className="mejin-badge mejin-badge--blue">{images.length} / {MAX_IMAGES}</span>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <ImageIcon className="h-4 w-4" style={{color:'var(--text-muted)'}} />
                  </div>
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onPaste={handleUrlInputPaste}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                    placeholder="Paste image URL…"
                    className="mejin-input w-full pl-9 pr-3 py-3 text-sm"
                  />
                </div>
                <button
                  onClick={() => { if (urlInput.trim()) { handleAddUrl(); } else { fileInputRef.current?.click(); } }}
                  disabled={images.length >= MAX_IMAGES}
                  className="mejin-btn-primary rounded-xl flex items-center justify-center"
                  style={{ width: '48px', height: '48px', flexShrink: 0 }}
                  aria-label="Add image"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs" style={{color:'var(--text-muted)'}}>Tip: paste (Ctrl+V) a screenshot directly, or click + to browse files.</p>

              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
                disabled={images.length >= MAX_IMAGES}
              />

              {/* Thumbnails grid */}
              {images.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className="relative group rounded-xl overflow-hidden cursor-pointer card-lift"
                      style={{aspectRatio:'1',background:'var(--bg-base)',border:'1.5px solid var(--border)'}}
                      onClick={() => setEnlargedImage(img.url)}
                    >
                      <img src={img.url} alt="Upload preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{background:'rgba(15,23,42,0.45)'}}>
                        <Eye className="w-5 h-5 text-white" />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                        className="absolute top-1.5 right-1.5 rounded-full p-1 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                        style={{background:'var(--danger)',minWidth:'22px',minHeight:'22px'}}
                        aria-label="Remove image"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Prompt & Config card is further below */}

          {/* Home Tab: Results Area */}
        {mainTab === 'home' && (isGenerating || currentResultValid) && (
          <div className="flex flex-col w-full max-w-xl mx-auto mt-4 px-2" style={{height:'80vh',maxHeight:'820px'}}>
            <div className="mejin-stage relative flex-1 rounded-[1.5rem] sm:rounded-[2.5rem] flex items-start justify-center p-2 sm:p-4 overflow-hidden">



              {isGenerating && (
                <div className="absolute inset-0 z-30 flex items-center justify-center backdrop-blur-xl transition-opacity duration-700" style={{background:'rgba(6,8,17,0.8)'}}>
                  {hasLoadingBlendImages && (
                    <div
                      className="absolute inset-0 opacity-55"
                      style={{
                        backgroundImage: `url(${loadingCurrentImageUrl || images[0]?.url || ''})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(44px) saturate(0.7)',
                        transform: `scale(${1.08 + loadingBlendRatio * 0.06})`,
                        transition: 'transform 320ms ease-out',
                      }}
                    />
                  )}

                  <div className="relative z-40 w-full max-w-5xl px-4">
                    <div className="mejin-loading-shell rounded-[2rem] p-4 sm:p-6 md:p-7">
                      {activeTab === 'image' && loadingImageCards.length > 0 ? (
                        <>
                          <div className={`grid ${loadingOutputCount <= 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'} gap-3 sm:gap-4`}>
                            {loadingImageCards.map((card) => (
                              <article
                                key={card.id}
                                className={`relative overflow-hidden rounded-2xl border min-h-44 sm:min-h-52 ${card.done ? 'border-blue-300' : 'border-slate-200'}`}
                              >
                                {card.imageUrl ? (
                                  <img
                                    src={card.imageUrl}
                                    alt={`Generating image ${card.index + 1}`}
                                    className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 ${card.done ? 'blur-none scale-100 saturate-100 opacity-100 cursor-pointer z-50' : 'blur-[8px] scale-110 saturate-[0.85] mejin-loading-drift opacity-60'}`}
                                    style={{ animationDelay: `${card.index * 280}ms` }}
                                    onClick={() => card.done && setEnlargedImage(card.imageUrl)}
                                  />
                                ) : (
                                  <div className="absolute inset-0 bg-blue-50/50" />
                                )}
                                <div className={`absolute inset-0 bg-gradient-to-t from-white/90 via-white/50 to-transparent ${card.done ? 'opacity-0' : 'opacity-100'}`} />
                                <div className={`absolute inset-0 blend-sweep pointer-events-none opacity-40 ${card.done ? 'hidden' : 'block'}`} />

                                <div className="absolute left-3 right-3 bottom-3 rounded-xl px-3 py-2.5 shadow-sm transition-all" style={{background:'rgba(6,8,17,0.75)',border:'1px solid rgba(255,255,255,0.08)',backdropFilter:'blur(12px)'}}>
                                  <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold tracking-wide" style={{color:'var(--text-soft)'}}>
                                    <span>Image {card.index + 1}</span>
                                    <span style={{color: card.done ? 'var(--accent)' : 'var(--text-muted)'}}>{card.done ? 'Completed' : 'Processing'}</span>
                                  </div>
                                  <p className="mt-1 text-sm sm:text-base font-black tracking-tight" style={{color:'var(--text)'}}>
                                    {formatElapsedClock(card.seconds)} {card.done ? 'to generate' : 'elapsed'}
                                  </p>
                                </div>
                              </article>
                            ))}
                          </div>

                          <div className="mt-4 sm:mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="px-3 py-1.5 rounded-full text-sm font-black tracking-wider flex items-center gap-1.5" style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'var(--text)'}}>
                                <Clock3 className="w-4 h-4" style={{color:'var(--accent)'}} />
                                {formatElapsedClock(elapsedSeconds)}
                              </div>
                              <p className="text-[11px] sm:text-sm font-bold uppercase tracking-[0.12em]" style={{color:'var(--text-soft)'}}>
                                {taskState || 'Running image synthesis...'}
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                generationControllerRef.current?.abort();
                                setTaskState('Cancelling generation...');
                              }}
                              className="mejin-btn-danger px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="py-8 sm:py-10 flex flex-col items-center gap-4">
                          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                          <div className="text-slate-800 text-4xl font-black tracking-tight">
                            {formatElapsedClock(elapsedSeconds)}
                          </div>
                          <p className="text-xs sm:text-sm uppercase tracking-[0.16em] font-semibold text-slate-600 text-center">
                            {taskState || 'Processing...'}
                          </p>
                          <button
                            onClick={() => {
                              generationControllerRef.current?.abort();
                              setTaskState('Cancelling generation...');
                            }}
                            className="mejin-btn-danger px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
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
                        setPreferredResultIndex(null);
                        setVideoResultUrl(null);
                        setMobileView('controls');
                      }}
                      className="pointer-events-auto px-5 py-2.5 rounded-full text-sm font-bold backdrop-blur-md shadow-lg transition-all hover:scale-105" style={{background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.12)',color:'var(--text)'}}
                    >
                      {'←'} Go Back
                    </button>
                    <div className="pointer-events-auto backdrop-blur-md rounded-full px-4 py-2 flex items-center gap-2 text-xs font-bold shadow-lg max-w-full sm:max-w-md" style={{background:'rgba(79,139,255,0.1)',border:'1px solid rgba(79,139,255,0.25)',color:'#93c5fd'}}>
                      <AlertCircle className="w-4 h-4 shrink-0" style={{color:'#60a5fa'}} />
                      Save results before leaving! Changes will be lost.
                    </div>
                  </div>
                  <div className="flex-1 w-full h-full relative flex items-center justify-center p-4">
                    {activeTab === 'image' && resultImages && (
                      selectedResult !== null ? (
                        <div className="w-full h-full relative group">
                          <button
                            onClick={() => setSelectedResult(null)}
                            className="absolute top-6 right-6 z-40 mejin-btn-danger px-5 py-2.5 rounded-full text-sm font-bold backdrop-blur-md shadow-lg transition-all"
                          >
                            <X className="w-4 h-4 inline-block mr-1" /> Close
                          </button>
                          {selectedResultItem && preferredResultIndex === selectedResult && (
                            <div className="absolute top-6 left-6 z-40 rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider shadow-lg" style={{background:'linear-gradient(135deg,var(--accent),var(--accent-2))',color:'#fff'}}>
                              Selected
                            </div>
                          )}
                          <div className="w-full h-full bg-slate-50 rounded-[2rem] border border-slate-200 overflow-hidden shadow-inner p-2 flex items-center justify-center">
                            <img
                              src={getResultImageUrl(selectedResultItem)}
                              alt="Selected Result"
                              className="max-w-full max-h-full object-contain rounded-2xl shadow-xl transition-all duration-500"
                            />
                          </div>
                          {Number.isFinite(getResultImageCost(selectedResultItem)) && (
                            <p className="mt-3 text-center text-sm font-bold text-sky-600">
                              {getTokenCostLabel(getResultImageCost(selectedResultItem), selectedResultItem?.tokenMode || 'estimated')}
                            </p>
                          )}
                          {Number.isFinite(getResultImageGenerationSeconds(selectedResultItem)) && (
                            <p className="mt-2 text-center text-xs font-bold uppercase tracking-wider text-blue-300">
                              Generated in {getResultImageGenerationSeconds(selectedResultItem)}s
                            </p>
                          )}
                          {getResultImagePrompt(selectedResultItem) && (
                            <div className="mt-3 mx-auto max-w-4xl rounded-xl p-3" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)'}}>
                              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{color:'var(--text-muted)'}}>Prompt Used</p>
                              <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-words" style={{color:'var(--text-soft)'}}>
                                {getResultImagePrompt(selectedResultItem)}
                              </pre>
                            </div>
                          )}
                          <div className="absolute bottom-4 sm:bottom-10 left-0 right-0 flex flex-wrap justify-center gap-3 sm:gap-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 px-3 sm:px-4">
                            <button
                              onClick={() => handleEnhanceTo4K(getResultImageUrl(selectedResultItem))}
                              className="mejin-btn-primary px-6 py-3 rounded-full font-bold flex items-center gap-2"
                            >
                              <Sparkles className="w-4 h-4" />
                              Enhance 4K
                            </button>

                            <a
                              href={getResultImageUrl(selectedResultItem)}
                              target="_blank"
                              rel="noreferrer"
                              className="btn-ghost px-6 py-3 rounded-full font-bold flex items-center gap-2"
                            >
                              <Download className="w-4 h-4" />
                              Save
                            </a>

                            <button
                              onClick={handleRerollFromPreferred}
                              className="btn-ghost px-6 py-3 rounded-full font-bold flex items-center gap-2"
                            >
                              <Wand2 className="w-4 h-4" />
                              Reroll
                            </button>

                            <button
                              onClick={() => handleImportSelectedResultToVeo(selectedResultItem)}
                              className="btn-ghost px-6 py-3 rounded-full font-bold flex items-center gap-2"
                            >
                              <Video className="w-4 h-4" />
                              To Veo
                            </button>

                            <button
                              onClick={() => handleRegenerateFromVariant(getResultImageUrl(selectedResultItem))}
                              className="btn-ghost px-6 py-3 rounded-full font-bold flex items-center gap-2"
                            >
                              <LayoutTemplate className="w-4 h-4" />
                              Use as Base
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col pt-14 sm:pt-16" style={{minHeight:0}}>
                          <h2 className="text-lg sm:text-xl font-black mb-2 sm:mb-3 text-center tracking-tight shrink-0" style={{color:'var(--text)'}}>Select result(s)</h2>
                          <div className={`grid grid-cols-2 gap-2 sm:gap-3 w-full px-1 sm:px-3 overflow-hidden`} style={{flex:'1 1 0',minHeight:0}}>
                            {resultImages.map((resultItem, idx) => {
                              const resultCost = getResultImageCost(resultItem);
                              const resultPrompt = getResultImagePrompt(resultItem);
                              const isPreferred = preferredResultIndex === idx;

                              return (
                                <div
                                  key={idx}
                                  className={`result-card rounded-2xl border-2 cursor-pointer ${
                                    selectedResultIndices.has(idx)
                                      ? 'border-blue-500 shadow-[0_0_16px_rgba(79,139,255,0.45)]'
                                      : 'border-transparent'
                                  } bg-black/30`}
                                  style={{aspectRatio:'3/4',minHeight:0}}
                                  onClick={() => {
                                    const next = new Set(selectedResultIndices);
                                    if (next.has(idx)) next.delete(idx); else next.add(idx);
                                    setSelectedResultIndices(next);
                                    setPreferredResultIndex(next.size > 0 ? [...next][next.size-1] : null);
                                  }}
                                >
                                  {/* Checkbox indicator */}
                                  <div className={`img-checkbox ${selectedResultIndices.has(idx) ? 'checked' : ''}`}>
                                    {selectedResultIndices.has(idx) && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                  </div>
                                  <img
                                    src={getResultImageUrl(resultItem)}
                                    alt={`Result Variant ${idx + 1}`}
                                    className="absolute inset-0 w-full h-full object-cover rounded-2xl transition-transform duration-500 group-hover/item:scale-105"
                                  />
                                  {/* Tap to view full */}
                                  <button
                                    type="button"
                                    className="absolute bottom-2 right-2 z-10 text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-md"
                                    style={{background:'rgba(0,0,0,0.55)',color:'rgba(255,255,255,0.85)',border:'1px solid rgba(255,255,255,0.12)'}}
                                    onClick={(e) => { e.stopPropagation(); setSelectedResult(idx); }}
                                  >
                                    View
                                  </button>
                                  {(Number.isFinite(resultCost) || Number.isFinite(getResultImageGenerationSeconds(resultItem))) && (
                                    <div className="absolute bottom-2 left-2 rounded-lg px-2 py-1 flex flex-col items-start gap-0 pointer-events-none z-10" style={{background:'rgba(0,0,0,0.55)',backdropFilter:'blur(6px)'}}>
                                      {Number.isFinite(resultCost) && (
                                        <span className="text-[9px] font-bold text-white tracking-wide">
                                          {getTokenCostLabel(resultCost, resultItem?.tokenMode || 'estimated')}
                                        </span>
                                      )}
                                      {Number.isFinite(getResultImageGenerationSeconds(resultItem)) && (
                                        <span className="text-[9px] font-semibold text-white/75 uppercase tracking-widest">
                                          {getResultImageGenerationSeconds(resultItem)}s
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2 flex justify-center">
                            <p className="text-xs font-semibold rounded-full px-4 py-2" style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',color:'var(--text-soft)'}}>
                              {selectedResultIndices.size > 0
                                ? `${selectedResultIndices.size} image${selectedResultIndices.size > 1 ? 's' : ''} selected`
                                : 'Tap images to select. Tap View to inspect.'}
                            </p>
                          </div>
                          <div className="flex flex-col sm:flex-row flex-wrap justify-center items-center gap-2 mt-3 mb-4 w-full max-w-2xl px-4 mx-auto">
                            <button
                              onClick={handleRerollFromPreferred}
                              disabled={selectedResultIndices.size === 0}
                              className="mejin-btn-primary w-full sm:w-auto flex-1 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-sm"
                            >
                              <Wand2 className="w-4 h-4 shrink-0" />
                              <span className="truncate">Reroll</span>
                            </button>
                            <button
                              onClick={handleImportPreferredToVeo}
                              disabled={selectedResultIndices.size === 0}
                              className="btn-ghost w-full sm:w-auto flex-1 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-sm"
                            >
                              <Video className="w-5 h-5 shrink-0" style={{color:'var(--accent)'}} />
                              <span className="truncate">To Veo 3.1</span>
                            </button>
                            <button
                              onClick={handleGenerate}
                              className="btn-ghost w-full sm:w-auto flex-1 px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-sm"
                            >
                              <Sparkles className="w-4 h-4 shrink-0" style={{color:'var(--accent)'}} />
                              <span className="truncate">Fresh Generate</span>
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
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
          {/* Prompt & Config Card */}
          <div className="mejin-panel p-5 flex flex-col gap-4">
              {/* Generation Output Configuration - Conditional on Tab */}
              {activeTab === 'image' ? (
                    <>
                      {/* Prompt */}
                      <div className="space-y-2 pt-2 text-left">
                        <span className="section-label">Prompt</span>
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          rows={2}
                          placeholder="Describe the scene for your image..."
                          className="mejin-textarea w-full px-4 py-3"
                        />
                      </div>
                      <div className="mejin-alert mejin-alert--info" style={{justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4" style={{color:'var(--primary)'}} />
                          <span className="text-sm font-bold" style={{color:'var(--text)'}}>GPT-5.2 Image Analysis</span>
                        </div>
                        <button
                          onClick={handleAnalyzePrompt}
                          disabled={isAnalyzingSuggestions || images.length === 0}
                          className="mejin-btn-secondary text-xs px-4 py-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {isAnalyzingSuggestions ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            'Analyze with AI'
                          )}
                        </button>
                      </div>

                      {/* Number of Outputs */}
                      <div className="space-y-3 pt-4" style={{borderTop:'1px solid var(--border)'}}>
                        <div className="flex justify-between items-center">
                          <span className="section-label">Output Variations</span>
                          <div className="flex rounded-full p-1" style={{background:'var(--bg-base)',border:'1px solid var(--border)'}}>
                            <button
                              onClick={() => setNumOutputs(2)}
                              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${numOutputs === 2 ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                            >
                              2 Layouts
                            </button>
                            <button
                              onClick={() => setNumOutputs(4)}
                              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${numOutputs === 4 ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                            >
                              4 Layouts
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Resolution & Aspect Ratio */}
                      <div className="grid grid-cols-2 gap-4 pt-4" style={{borderTop:'1px solid var(--border)'}}>
                        <div className="space-y-2">
                          <span className="section-label">Resolution</span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {['1K', '2K', '4K'].map((res) => (
                              <button
                                key={res}
                                onClick={() => setResolution(res)}
                                className={`py-2 rounded-xl text-xs font-bold transition-all ${resolution === res ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                              >
                                {res}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="section-label">Aspect Ratio</span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {['auto', '1:1', '4:3', '3:4', '16:9', '9:16'].map((ratio) => (
                              <button
                                key={ratio}
                                onClick={() => setAspectRatio(ratio)}
                                className={`py-2 rounded-xl text-xs font-bold transition-all ${aspectRatio === ratio ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                              >
                                {ratio}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                    </>
                  ) : (
                    <>
                      {/* Type */}
                      <div className="space-y-2 pt-2">
                        <span className="section-label">Generation Type</span>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            onClick={() => { setVideoGenerationType('text2vid'); }}
                            className={`py-3 rounded-xl text-xs font-bold transition-all ${videoGenerationType === 'text2vid' ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                          >
                            Text to Video
                          </button>
                          <button
                            onClick={() => { setVideoGenerationType('img2vid'); setVideoModel('veo3'); }}
                            className={`py-3 rounded-xl text-xs font-bold transition-all ${videoGenerationType === 'img2vid' ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                          >
                            Frames to Video
                          </button>
                          <button
                            onClick={() => { setVideoGenerationType('ref2vid'); setVideoModel('veo3_fast'); }}
                            className={`py-3 rounded-xl text-xs font-bold transition-all ${videoGenerationType === 'ref2vid' ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                          >
                            Reference to Video
                          </button>
                        </div>
                      </div>

                      {/* Prompt */}
                      <div className="space-y-2 mt-3">
                        <span className="section-label">Video Scene Prompt</span>
                        <textarea
                          value={videoPrompt}
                          onChange={(e) => setVideoPrompt(e.target.value)}
                          rows={3}
                          placeholder="Describe the motion, action, and scene..."
                          className="mejin-textarea w-full px-4 py-3"
                        />
                      </div>

                      {/* Model & Aspect Ratio */}
                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div className="space-y-2">
                          <span className="section-label">Veo Model</span>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setVideoModel('veo3')}
                              disabled={videoGenerationType === 'ref2vid'}
                              className={`py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${videoModel === 'veo3' ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                            >
                              Veo 3
                            </button>
                            <button
                              onClick={() => setVideoModel('veo3_fast')}
                              className={`py-2 rounded-xl text-xs font-bold transition-all ${videoModel === 'veo3_fast' ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                            >
                              Veo 3 Fast
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="section-label">Format</span>
                          <div className="grid grid-cols-2 gap-2">
                            {VIDEO_ASPECT_RATIOS.map((ratio) => (
                              <button
                                key={ratio}
                                onClick={() => setVideoAspectRatio(ratio)}
                                className={`py-2 rounded-xl text-xs font-bold transition-all ${videoAspectRatio === ratio ? 'mejin-chip mejin-chip--active' : 'mejin-chip'}`}
                              >
                                {ratio}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                    </>
                  )}


          </div>{/* end config card */}

          {/* Generate Button */}
          <div className="w-full">
            <button
              onClick={activeTab === 'image' ? handleGenerate : handleVideoGenerate}
              disabled={isGenerating || (activeTab === 'video' && videoGenerationType !== 'text2vid' && images.length === 0) || (activeTab === 'image' && images.length === 0)}
              className="mejin-btn-primary w-full rounded-2xl py-4 px-6 flex flex-col items-center justify-center glow-pulse"
              style={{minHeight:'60px'}}
            >
              {isGenerating ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-bold">Generating...</span>
                </div>
              ) : (
                <>
                  <span className="text-lg font-black tracking-tight">{activeTab === 'image' ? '✦ Imagine Now' : '✦ Animate Now'}</span>
                  <span className="text-xs mt-0.5" style={{color:'rgba(255,255,255,0.65)'}}>Powered by AI</span>
                </>
              )}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mejin-alert mejin-alert--error">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Task state */}
          {taskState && !error && (
            <p className="text-xs font-bold text-center animate-pulse" style={{color:'var(--primary)'}}>{taskState}</p>
          )}
        </div>
        )}


      {mainTab === 'history' && (
        <div className="w-full max-w-xl mx-auto flex flex-col items-center">
          <div className="mejin-panel w-full rounded-[2rem] overflow-hidden p-5 sm:p-8 space-y-6 flex flex-col items-center">
            
            <div className="flex items-center justify-between w-full pb-4" style={{borderBottom:'1px solid var(--border)'}}>
              <div className="flex items-center gap-2">
                <History className="w-5 h-5" style={{color:'var(--text-secondary)'}} />
                <h3 className="text-lg font-bold" style={{color:'var(--text)'}}>Generation History</h3>
              </div>
              <button
                onClick={clearHistory}
                disabled={generationHistory.length === 0}
                className="mejin-btn-danger text-xs px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>

            {generationHistory.length === 0 ? (
              <p className="text-sm rounded-xl px-4 py-8 w-full text-center font-medium" style={{color:'var(--text-muted)',background:'var(--bg-base)',border:'1px solid var(--border)'}}>
                No history yet. Your generated images will appear here.
              </p>
            ) : (
              <div className="space-y-4 w-full">
                {generationHistory.map((entry) => {
                  const entryOutputs = Array.isArray(entry?.outputs) ? entry.outputs : [];
                  const firstOutputUrl = entryOutputs.length > 0 ? getResultImageUrl(entryOutputs[0]) : '';
                  return (
                    <article key={entry.id || `${entry.createdAt || 'time'}-${entry.prompt || 'prompt'}`} className="rounded-2xl p-4 space-y-3 transition-all card-lift" style={{background:'var(--bg-surface)',border:'1px solid var(--border)',boxShadow:'var(--shadow-xs)'}}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium" style={{color:'var(--text-muted)'}}>{formatHistoryDate(entry.createdAt)}</span>
                        <span className="mejin-badge mejin-badge--blue">
                          {getTokenCostLabel(toNumberOrNull(entry.totalTokenUsed), entry.costMode || 'estimated')}
                        </span>
                      </div>
                      <p className="text-sm leading-snug" style={{color:'var(--text-secondary)'}}>
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
                                onClick={() => {
                                  handleRegenerateFromVariant(outputUrl);
                                  setMainTab('home');
                                }}
                                className="relative w-full rounded-xl overflow-hidden transition-colors" style={{border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)'}}
                              >
                                <img src={outputUrl} alt={`History output ${index + 1}`} className="w-full h-16 sm:h-20 object-cover" />
                                {Number.isFinite(outputCost) && (
                                  <span className="absolute bottom-1 left-1 right-1 text-[10px] font-bold text-white rounded-md px-1 py-0.5 truncate" style={{background:'rgba(0,0,0,0.6)'}}>
                                    {getTokenCostLabel(outputCost, output?.tokenMode || entry.costMode || 'estimated')}
                                  </span>
                                )}
                              </button>
                              {outputPrompt && (
                                <pre
                                  className="text-[10px] font-mono rounded-md px-1.5 py-1 whitespace-pre-wrap break-words overflow-hidden" style={{color:'var(--text-muted)',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}
                                >
                                  {outputPrompt}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-2">
                        <button
                          onClick={() => {
                            handleOpenHistoryEntry(entry);
                            setMainTab('home');
                          }}
                          className="text-xs px-4 py-2 rounded-full font-bold transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'var(--text)'}}
                        >
                          Open Result
                        </button>
                        <button
                          onClick={() => {
                            if (firstOutputUrl) {
                              handleRegenerateFromVariant(firstOutputUrl);
                              setMainTab('home');
                            }
                          }}
                          disabled={!firstOutputUrl}
                          className="text-xs px-4 py-2 rounded-full font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-80" style={{background:'rgba(79,139,255,0.1)',border:'1px solid rgba(79,139,255,0.25)',color:'#93c5fd'}}
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
        </div>
      )}

      {/* Main Tab Views: Settings */}
      {mainTab === 'settings' && (
        <div className="w-full max-w-xl mx-auto flex flex-col items-center">
          <div className="mejin-panel w-full rounded-[2rem] overflow-hidden p-5 sm:p-8 space-y-6 flex flex-col">
            
            <div className="flex items-center gap-2 pb-4" style={{borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
              <Settings className="w-6 h-6" style={{color:'var(--text-soft)'}} />
              <h2 className="text-xl font-bold tracking-tight" style={{color:'var(--text)'}}>Settings</h2>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold uppercase tracking-wider text-left" style={{color:'var(--text-muted)'}}>Kie.ai Access Token</label>
                <span className={`text-xs font-bold uppercase tracking-wider`} style={{color: connectionStatus === 'success' && !hasLowBalance ? 'var(--success)' : 'var(--danger)'}}>
                  {connectionStatus === 'success' && !hasLowBalance ? `Connected (${normalizedCredits !== null ? normalizedCredits.toFixed(2) : '0.00'} Tokens)` : 'Disconnected'}
                </span>
              </div>
              <p className="text-sm" style={{color:'var(--text-soft)'}}>
                To generate images and use the GPT-5-2 Vision analyzer, you need a valid Kie.ai API key. Enter it below to sync.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setConnectionStatus('idle');
                    setCredits(null);
                  }}
                  placeholder="Paste token..."
                  className="flex-1 rounded-xl px-4 py-4 text-base"
                  style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',color:'var(--text)'}}
                />
                <button
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !apiKey}
                  className="mejin-btn-primary disabled:opacity-40 px-6 py-4 rounded-xl text-sm font-bold transition-all active:scale-95 sm:w-auto w-full"
                >
                  Sync Token
                </button>
              </div>
              {connectionMessage && (
                <p className={`text-sm font-semibold mt-2`} style={{color: connectionStatus === 'success' ? 'var(--success)' : 'var(--danger)'}}>
                  {connectionMessage}
                </p>
              )}
            </div>

          </div>
        </div>
      )}
      </main>

      {/* Bottom Navigation — Clean White Tab Bar */}
      <nav className="mejin-nav-container">
        <div className="max-w-xl mx-auto px-2 h-16 flex justify-around items-center">
          <button
            onClick={() => { setMainTab('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className={`mejin-nav-btn ${mainTab === 'home' ? 'mejin-nav-btn--active' : ''}`}
          >
            <div className="mejin-nav-icon-wrap"><Sparkles className="w-5 h-5" /></div>
            <span>Generate</span>
          </button>

          <button
            onClick={() => { setMainTab('history'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className={`mejin-nav-btn ${mainTab === 'history' ? 'mejin-nav-btn--active' : ''}`}
          >
            <div className="mejin-nav-icon-wrap"><History className="w-5 h-5" /></div>
            <span>History</span>
          </button>

          <button
            onClick={() => { setMainTab('settings'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className={`mejin-nav-btn ${mainTab === 'settings' ? 'mejin-nav-btn--active' : ''}`}
          >
            <div className="mejin-nav-icon-wrap"><Settings className="w-5 h-5" /></div>
            <span>Settings</span>
          </button>
        </div>
      </nav>

      {/* Fullscreen Image Overlay Modal */}
      {enlargedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out"
          onClick={() => setEnlargedImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] w-full h-full flex items-center justify-center">
            <button
              onClick={() => setEnlargedImage(null)}
              className="absolute -top-4 -right-4 sm:top-0 sm:right-0 bg-rose-600 hover:bg-rose-500 text-white p-2 rounded-full shadow-lg transition-transform hover:scale-110 z-50"
            >
              <X className="w-5 h-5" />
            </button>
            <img 
              src={enlargedImage} 
              alt="Enlarged view" 
              className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl border border-slate-700/50 cursor-default"
              onClick={(e) => e.stopPropagation()} 
            />
          </div>
        </div>
      )}

    </div>
  );
}

export default App;

