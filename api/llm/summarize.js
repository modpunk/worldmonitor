/**
 * LLM Summarization Module
 * 
 * Provides text summarization using local LLMs with 4-tier fallback:
 * Tier 1: Ollama (localhost:11434)
 * Tier 2: LM Studio (localhost:1234)
 * Tier 3: Custom local endpoint
 * Tier 4: Extractive summarization (no LLM needed)
 * 
 * Each request reports model_used in the response for traceability.
 */

const {
  discoverModels,
  ENDPOINTS,
  fetchWithTimeout,
  getCircuitBreakerStatuses
} = require('./discovery');

const DEFAULT_SUMMARIZE_PROMPT = `You are a concise summarizer. Summarize the following text in a clear and brief manner, preserving key points:`;

/**
 * Extractive summarization fallback.
 * Uses sentence scoring based on word frequency to extract key sentences.
 * No LLM required - pure algorithmic approach.
 */
function extractiveSummarization(text, options = {}) {
  const maxSentences = options.maxSentences || 5;
  const minSentenceLength = options.minSentenceLength || 20;

  if (!text || text.trim().length === 0) {
    return { summary: '', model_used: 'extractive-fallback', tier: 4 };
  }

  // Split into sentences
  const sentences = text
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length >= minSentenceLength);

  if (sentences.length === 0) {
    return { summary: text.substring(0, 500), model_used: 'extractive-fallback', tier: 4 };
  }

  if (sentences.length <= maxSentences) {
    return { summary: sentences.join(' '), model_used: 'extractive-fallback', tier: 4 };
  }

  // Build word frequency map (excluding stop words)
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
    'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
    'just', 'because', 'if', 'when', 'where', 'how', 'what', 'which',
    'who', 'whom', 'this', 'that', 'these', 'those', 'it', 'its',
    'he', 'she', 'they', 'them', 'his', 'her', 'their', 'we', 'our',
    'i', 'me', 'my', 'you', 'your'
  ]);

  const wordFreq = {};
  const allWords = text.toLowerCase().match(/\b[a-z]+\b/g) || [];
  for (const word of allWords) {
    if (!stopWords.has(word) && word.length > 2) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  }

  // Score sentences based on word frequency
  const scored = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().match(/\b[a-z]+\b/g) || [];
    let score = 0;
    for (const word of words) {
      score += wordFreq[word] || 0;
    }
    // Normalize by sentence length
    score = words.length > 0 ? score / words.length : 0;
    // Boost first sentences (positional bias)
    if (index < 2) score *= 1.5;
    return { sentence, score, index };
  });

  // Select top sentences, maintain original order
  const topSentences = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence);

  return {
    summary: topSentences.join(' '),
    model_used: 'extractive-fallback',
    tier: 4,
    method: 'extractive summarization'
  };
}

/**
 * Generate summary via Ollama (localhost:11434)
 */
async function summarizeWithOllama(text, model, options = {}) {
  const endpoint = ENDPOINTS.ollama;
  const prompt = `${options.systemPrompt || DEFAULT_SUMMARIZE_PROMPT}\n\n${text}`;

  const response = await fetchWithTimeout(
    `${endpoint.base}${endpoint.generatePath}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: options.temperature || 0.3,
          num_predict: options.maxTokens || 512
        }
      })
    },
    options.timeoutMs || 60000
  );

  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json();

  return {
    summary: data.response || '',
    model_used: model,
    provider: 'ollama',
    tier: 1,
    eval_count: data.eval_count,
    eval_duration: data.eval_duration
  };
}

/**
 * Generate summary via LM Studio (localhost:1234)
 */
async function summarizeWithLMStudio(text, model, options = {}) {
  const endpoint = ENDPOINTS.lmstudio;
  const response = await fetchWithTimeout(
    `${endpoint.base}${endpoint.chatPath}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: options.systemPrompt || DEFAULT_SUMMARIZE_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: options.temperature || 0.3,
        max_tokens: options.maxTokens || 512,
        stream: false
      })
    },
    options.timeoutMs || 60000
  );

  if (!response.ok) throw new Error(`LM Studio HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  return {
    summary: content,
    model_used: model,
    provider: 'lmstudio',
    tier: 2,
    usage: data.usage
  };
}

/**
 * Generate summary via custom endpoint
 */
async function summarizeWithCustom(text, model, options = {}) {
  const endpoint = ENDPOINTS.custom;
  const response = await fetchWithTimeout(
    `${endpoint.base}${endpoint.chatPath}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: options.systemPrompt || DEFAULT_SUMMARIZE_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: options.temperature || 0.3,
        max_tokens: options.maxTokens || 512,
        stream: false
      })
    },
    options.timeoutMs || 60000
  );

  if (!response.ok) throw new Error(`Custom endpoint HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || data.response || '';

  return {
    summary: content,
    model_used: model,
    provider: 'custom',
    tier: 3
  };
}

/**
 * Main summarize function with 4-tier fallback strategy.
 * 
 * Automatically discovers available models and uses the highest-priority
 * available tier. Falls back to extractive summarization if no LLM is available.
 * 
 * @param {string} text - Text to summarize
 * @param {object} options - Configuration options
 * @param {string} options.preferredModel - Specific model to use
 * @param {string} options.preferredProvider - Preferred provider (ollama/lmstudio/custom)
 * @param {number} options.maxTokens - Max tokens for generation
 * @param {number} options.temperature - Sampling temperature
 * @param {string} options.systemPrompt - Custom system prompt
 * @param {number} options.maxSentences - Max sentences for extractive fallback
 * @param {number} options.timeoutMs - Request timeout in ms
 * @returns {object} { summary, model_used, provider, tier, ... }
 */
async function summarize(text, options = {}) {
  if (!text || text.trim().length === 0) {
    return {
      summary: '',
      model_used: 'none',
      provider: 'none',
      tier: 0,
      error: 'Empty input text'
    };
  }

  // Discover available models
  let discovery;
  try {
    discovery = await discoverModels();
  } catch (err) {
    // If discovery itself fails, go straight to extractive
    return {
      ...extractiveSummarization(text, options),
      discoveryError: err.message
    };
  }

  const { activeTier, provider, models } = discovery;

  // If preferred provider is specified, attempt it first
  if (options.preferredProvider && options.preferredModel) {
    try {
      const result = await attemptSummarization(
        text,
        options.preferredProvider,
        options.preferredModel,
        options
      );
      return result;
    } catch (err) {
      // Fall through to discovered tier
    }
  }

  // Use discovered tier
  if (activeTier === 4 || provider === 'extractive') {
    // Tier 4: extractive summarization - no LLM available
    return extractiveSummarization(text, options);
  }

  const selectedModel = options.preferredModel || (models[0] && models[0].id);
  if (!selectedModel) {
    return extractiveSummarization(text, options);
  }

  try {
    const result = await attemptSummarization(text, provider, selectedModel, options);
    return result;
  } catch (err) {
    // On failure, try lower tiers then fall back to extractive
    const tierOrder = ['ollama', 'lmstudio', 'custom'];
    const startIdx = tierOrder.indexOf(provider) + 1;

    for (let i = startIdx; i < tierOrder.length; i++) {
      try {
        const fallbackDiscovery = await discoverModelsForProvider(tierOrder[i]);
        if (fallbackDiscovery.length > 0) {
          const result = await attemptSummarization(
            text, tierOrder[i], fallbackDiscovery[0].id, options
          );
          return result;
        }
      } catch {
        continue;
      }
    }

    // Final fallback: extractive summarization
    return {
      ...extractiveSummarization(text, options),
      fallbackReason: err.message
    };
  }
}

async function attemptSummarization(text, provider, model, options) {
  switch (provider) {
    case 'ollama':
      return summarizeWithOllama(text, model, options);
    case 'lmstudio':
      return summarizeWithLMStudio(text, model, options);
    case 'custom':
      return summarizeWithCustom(text, model, options);
    case 'extractive':
      return extractiveSummarization(text, options);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function discoverModelsForProvider(provider) {
  const { discoverOllamaModels, discoverLMStudioModels, discoverCustomModels } = require('./discovery');
  switch (provider) {
    case 'ollama': return discoverOllamaModels();
    case 'lmstudio': return discoverLMStudioModels();
    case 'custom': return discoverCustomModels();
    default: return [];
  }
}

/**
 * Get the current status of all LLM backends
 */
async function getStatus() {
  const discovery = await discoverModels();
  const circuitBreakers = getCircuitBreakerStatuses();

  return {
    activeTier: discovery.activeTier,
    activeProvider: discovery.provider,
    availableModels: discovery.models,
    errors: discovery.errors,
    circuitBreakers
  };
}

module.exports = {
  summarize,
  extractiveSummarization,
  summarizeWithOllama,
  summarizeWithLMStudio,
  summarizeWithCustom,
  getStatus,
  DEFAULT_SUMMARIZE_PROMPT
};
