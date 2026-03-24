/**
 * LLM Model Discovery Module
 * 
 * Implements 4-tier fallback strategy for local LLM model discovery:
 * Tier 1: Ollama (localhost:11434)
 * Tier 2: LM Studio (localhost:1234)
 * Tier 3: Local custom endpoint
 * Tier 4: Extractive summarization fallback (no LLM needed)
 */

const ENDPOINTS = {
  ollama: {
    name: 'Ollama',
    base: 'http://localhost:11434',
    modelsPath: '/api/tags',
    generatePath: '/api/generate',
    chatPath: '/api/chat',
    tier: 1
  },
  lmstudio: {
    name: 'LM Studio',
    base: 'http://localhost:1234',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    tier: 2
  },
  custom: {
    name: 'Custom Local',
    base: process.env.CUSTOM_LLM_URL || 'http://localhost:8080',
    modelsPath: '/models',
    chatPath: '/v1/chat/completions',
    tier: 3
  }
};

// Circuit breaker state per endpoint
const circuitBreakers = {};

const CIRCUIT_BREAKER_DEFAULTS = {
  failureThreshold: 3,
  resetTimeoutMs: 30000, // 30 seconds
  halfOpenMaxAttempts: 1
};

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.failureThreshold = options.failureThreshold || CIRCUIT_BREAKER_DEFAULTS.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs || CIRCUIT_BREAKER_DEFAULTS.resetTimeoutMs;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || CIRCUIT_BREAKER_DEFAULTS.halfOpenMaxAttempts;
    this.halfOpenAttempts = 0;
  }

  canAttempt() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        return true;
      }
      return false;
    }
    if (this.state === 'HALF_OPEN') {
      return this.halfOpenAttempts < this.halfOpenMaxAttempts;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.successCount++;
    this.state = 'CLOSED';
    this.halfOpenAttempts = 0;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}

function getCircuitBreaker(name) {
  if (!circuitBreakers[name]) {
    circuitBreakers[name] = new CircuitBreaker(name);
  }
  return circuitBreakers[name];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverOllamaModels() {
  const endpoint = ENDPOINTS.ollama;
  const cb = getCircuitBreaker('ollama');
  if (!cb.canAttempt()) {
    throw new Error(`Circuit breaker OPEN for ${endpoint.name}`);
  }
  try {
    // localhost:11434 - Ollama API
    const response = await fetchWithTimeout(`${endpoint.base}${endpoint.modelsPath}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = (data.models || []).map(m => ({
      id: m.name || m.model,
      name: m.name || m.model,
      size: m.size,
      provider: 'ollama',
      tier: endpoint.tier
    }));
    cb.recordSuccess();
    return models;
  } catch (err) {
    cb.recordFailure();
    throw err;
  }
}

async function discoverLMStudioModels() {
  const endpoint = ENDPOINTS.lmstudio;
  const cb = getCircuitBreaker('lmstudio');
  if (!cb.canAttempt()) {
    throw new Error(`Circuit breaker OPEN for ${endpoint.name}`);
  }
  try {
    // localhost:1234 - LM Studio API
    const response = await fetchWithTimeout(`${endpoint.base}${endpoint.modelsPath}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = (data.data || []).map(m => ({
      id: m.id,
      name: m.id,
      owned_by: m.owned_by,
      provider: 'lmstudio',
      tier: endpoint.tier
    }));
    cb.recordSuccess();
    return models;
  } catch (err) {
    cb.recordFailure();
    throw err;
  }
}

async function discoverCustomModels() {
  const endpoint = ENDPOINTS.custom;
  const cb = getCircuitBreaker('custom');
  if (!cb.canAttempt()) {
    throw new Error(`Circuit breaker OPEN for ${endpoint.name}`);
  }
  try {
    const response = await fetchWithTimeout(`${endpoint.base}${endpoint.modelsPath}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = (data.data || data.models || []).map(m => ({
      id: m.id || m.name,
      name: m.id || m.name,
      provider: 'custom',
      tier: endpoint.tier
    }));
    cb.recordSuccess();
    return models;
  } catch (err) {
    cb.recordFailure();
    throw err;
  }
}

/**
 * Discover all available models using 4-tier fallback strategy.
 * Returns models from the highest-priority available tier.
 * 
 * 4-tier fallback:
 *   Tier 1: Ollama (localhost:11434)
 *   Tier 2: LM Studio (localhost:1234)
 *   Tier 3: Custom local endpoint
 *   Tier 4: Extractive summarization (no model needed)
 */
async function discoverModels() {
  const results = {
    models: [],
    errors: [],
    activeTier: null,
    provider: null
  };

  // Tier 1: Ollama
  try {
    const models = await discoverOllamaModels();
    if (models.length > 0) {
      results.models = models;
      results.activeTier = 1;
      results.provider = 'ollama';
      return results;
    }
  } catch (err) {
    results.errors.push({ tier: 1, provider: 'ollama', error: err.message });
  }

  // Tier 2: LM Studio
  try {
    const models = await discoverLMStudioModels();
    if (models.length > 0) {
      results.models = models;
      results.activeTier = 2;
      results.provider = 'lmstudio';
      return results;
    }
  } catch (err) {
    results.errors.push({ tier: 2, provider: 'lmstudio', error: err.message });
  }

  // Tier 3: Custom
  try {
    const models = await discoverCustomModels();
    if (models.length > 0) {
      results.models = models;
      results.activeTier = 3;
      results.provider = 'custom';
      return results;
    }
  } catch (err) {
    results.errors.push({ tier: 3, provider: 'custom', error: err.message });
  }

  // Tier 4: Extractive summarization fallback (no LLM required)
  results.activeTier = 4;
  results.provider = 'extractive';
  results.models = [{
    id: 'extractive-fallback',
    name: 'Extractive Summarization (no LLM)',
    provider: 'extractive',
    tier: 4
  }];

  return results;
}

function getCircuitBreakerStatuses() {
  return Object.values(circuitBreakers).map(cb => cb.getStatus());
}

function resetCircuitBreakers() {
  Object.keys(circuitBreakers).forEach(key => {
    delete circuitBreakers[key];
  });
}

module.exports = {
  discoverModels,
  discoverOllamaModels,
  discoverLMStudioModels,
  discoverCustomModels,
  getCircuitBreakerStatuses,
  resetCircuitBreakers,
  CircuitBreaker,
  ENDPOINTS,
  fetchWithTimeout
};
