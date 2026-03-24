/**
 * Server-side AI classification system for headlines.
 * Moves classification logic from client to server for improved
 * performance and better caching strategies.
 */

const CATEGORIES = [
  'politics',
  'technology',
  'science',
  'health',
  'business',
  'entertainment',
  'sports',
  'world',
  'environment',
  'education',
];

const KEYWORD_MAP = {
  politics: [
    'election', 'president', 'congress', 'senate', 'democrat', 'republican',
    'vote', 'legislation', 'policy', 'government', 'campaign', 'ballot',
    'partisan', 'bipartisan', 'lawmaker', 'political', 'parliament', 'minister',
  ],
  technology: [
    'ai', 'artificial intelligence', 'software', 'hardware', 'startup', 'tech',
    'algorithm', 'data', 'cyber', 'digital', 'app', 'robot', 'automation',
    'blockchain', 'crypto', 'cloud', 'machine learning', 'computer', 'internet',
  ],
  science: [
    'research', 'study', 'scientist', 'discovery', 'experiment', 'physics',
    'chemistry', 'biology', 'space', 'nasa', 'genome', 'quantum', 'theory',
    'laboratory', 'molecule', 'particle', 'asteroid', 'telescope',
  ],
  health: [
    'health', 'medical', 'doctor', 'hospital', 'disease', 'vaccine', 'drug',
    'patient', 'treatment', 'symptom', 'mental health', 'pandemic', 'virus',
    'cancer', 'therapy', 'clinical', 'diagnosis', 'pharmaceutical', 'wellness',
  ],
  business: [
    'market', 'stock', 'economy', 'trade', 'company', 'revenue', 'profit',
    'investment', 'ceo', 'merger', 'acquisition', 'ipo', 'gdp', 'inflation',
    'bank', 'finance', 'corporate', 'earnings', 'wall street',
  ],
  entertainment: [
    'movie', 'film', 'music', 'celebrity', 'hollywood', 'oscar', 'grammy',
    'streaming', 'netflix', 'concert', 'album', 'actor', 'actress', 'award',
    'box office', 'tv show', 'series', 'director', 'premiere',
  ],
  sports: [
    'game', 'team', 'player', 'championship', 'league', 'nba', 'nfl', 'mlb',
    'soccer', 'football', 'basketball', 'baseball', 'tennis', 'olympic',
    'coach', 'score', 'tournament', 'athlete', 'match', 'stadium',
  ],
  world: [
    'international', 'global', 'country', 'foreign', 'united nations', 'war',
    'conflict', 'diplomacy', 'treaty', 'refugee', 'humanitarian', 'border',
    'sanctions', 'nato', 'embassy', 'geopolitical', 'summit',
  ],
  environment: [
    'climate', 'environment', 'carbon', 'emission', 'renewable', 'solar',
    'wind energy', 'pollution', 'deforestation', 'ocean', 'biodiversity',
    'sustainable', 'green', 'fossil fuel', 'conservation', 'ecosystem',
  ],
  education: [
    'school', 'university', 'student', 'teacher', 'education', 'college',
    'academic', 'curriculum', 'degree', 'scholarship', 'tuition', 'campus',
    'learning', 'professor', 'classroom', 'graduation',
  ],
};

// Simple in-memory cache with TTL
const classificationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000;

/**
 * Generate a cache key from the headline text.
 */
function getCacheKey(headline) {
  return headline.trim().toLowerCase();
}

/**
 * Retrieve a cached classification result if still valid.
 */
function getCachedResult(key) {
  const entry = classificationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    classificationCache.delete(key);
    return null;
  }
  return entry.result;
}

/**
 * Store a classification result in the cache.
 */
function setCachedResult(key, result) {
  // Evict oldest entries if cache is full
  if (classificationCache.size >= MAX_CACHE_SIZE) {
    const firstKey = classificationCache.keys().next().value;
    classificationCache.delete(firstKey);
  }
  classificationCache.set(key, { result, timestamp: Date.now() });
}

/**
 * Classify a single headline by matching keywords and computing
 * confidence scores for each category.
 *
 * @param {string} headline - The headline text to classify.
 * @returns {object} Classification result with category, confidence, and scores.
 */
function classify(headline) {
  if (!headline || typeof headline !== 'string') {
    return {
      category: 'unknown',
      confidence: 0,
      scores: {},
      headline: headline || '',
    };
  }

  const cacheKey = getCacheKey(headline);
  const cached = getCachedResult(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const normalizedHeadline = headline.toLowerCase();
  const scores = {};
  let totalMatches = 0;

  for (const category of CATEGORIES) {
    const keywords = KEYWORD_MAP[category] || [];
    let matchCount = 0;
    let weightedScore = 0;

    for (const keyword of keywords) {
      if (normalizedHeadline.includes(keyword)) {
        matchCount++;
        // Longer keyword matches are weighted more heavily
        weightedScore += keyword.length / 5;
      }
    }

    scores[category] = weightedScore;
    totalMatches += matchCount;
  }

  // Determine best category
  let bestCategory = 'unknown';
  let bestScore = 0;

  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // Calculate confidence as a normalized value between 0 and 1
  const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
  let confidence = 0;
  if (totalScore > 0) {
    confidence = Math.min(bestScore / totalScore, 1);
    // Boost confidence if there's a clear winner
    const sortedScores = Object.values(scores).sort((a, b) => b - a);
    if (sortedScores.length > 1 && sortedScores[1] > 0) {
      const separation = sortedScores[0] / sortedScores[1];
      confidence = Math.min(confidence * Math.min(separation, 2) / 2 + 0.3, 1);
    } else if (bestScore > 0) {
      confidence = Math.min(0.85 + bestScore / 50, 1);
    }
  }

  confidence = Math.round(confidence * 100) / 100;

  const result = {
    category: bestCategory,
    confidence,
    scores,
    headline,
  };

  setCachedResult(cacheKey, result);

  return result;
}

/**
 * Classify a batch of headlines in a single call.
 * This is more efficient than classifying one at a time because it
 * leverages caching and reduces overhead.
 *
 * @param {string[]} headlines - Array of headline strings.
 * @returns {object} Batch classification results with metadata.
 */
function classifyBatch(headlines) {
  if (!Array.isArray(headlines)) {
    return {
      error: 'Input must be an array of headline strings',
      results: [],
      metadata: { total: 0, classified: 0, cached: 0, failed: 0 },
    };
  }

  const results = [];
  let cachedCount = 0;
  let failedCount = 0;

  for (const headline of headlines) {
    try {
      const result = classify(headline);
      if (result.cached) {
        cachedCount++;
      }
      results.push(result);
    } catch (err) {
      failedCount++;
      results.push({
        category: 'unknown',
        confidence: 0,
        scores: {},
        headline: headline || '',
        error: err.message,
      });
    }
  }

  const classified = results.filter(
    (r) => r.category !== 'unknown' && r.confidence > 0
  ).length;

  return {
    results,
    metadata: {
      total: headlines.length,
      classified,
      cached: cachedCount,
      failed: failedCount,
      averageConfidence:
        results.length > 0
          ? Math.round(
              (results.reduce((sum, r) => sum + (r.confidence || 0), 0) /
                results.length) *
                100
            ) / 100
          : 0,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Get classification statistics and category distribution
 * from a batch of results.
 *
 * @param {object[]} results - Array of classification result objects.
 * @returns {object} Distribution and statistics.
 */
function getClassificationStats(results) {
  const distribution = {};
  const confidenceBuckets = {
    high: 0,   // >= 0.7
    medium: 0, // >= 0.4
    low: 0,    // < 0.4
  };

  for (const result of results) {
    const cat = result.category || 'unknown';
    distribution[cat] = (distribution[cat] || 0) + 1;

    if (result.confidence >= 0.7) {
      confidenceBuckets.high++;
    } else if (result.confidence >= 0.4) {
      confidenceBuckets.medium++;
    } else {
      confidenceBuckets.low++;
    }
  }

  return {
    distribution,
    confidenceBuckets,
    totalClassified: results.length,
  };
}

/**
 * Clear the classification cache. Useful for testing or forced refresh.
 */
function clearCache() {
  classificationCache.clear();
  return { cleared: true, timestamp: new Date().toISOString() };
}

/**
 * Main API handler for the classify-headlines endpoint.
 * Supports both single headline and batch classification.
 *
 * @param {object} req - HTTP request object.
 * @param {object} res - HTTP response object.
 */
async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    if (req.method === 'GET') {
      // Health check / info endpoint
      return res.status(200).json({
        service: 'classify-headlines',
        status: 'ok',
        categories: CATEGORIES,
        cacheSize: classificationCache.size,
        version: '1.0.0',
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      if (!body) {
        return res.status(400).json({ error: 'Request body is required' });
      }

      // Single headline classification
      if (body.headline && typeof body.headline === 'string') {
        const result = classify(body.headline);
        return res.status(200).json(result);
      }

      // Batch classification of headlines
      if (body.headlines && Array.isArray(body.headlines)) {
        const batchResult = classifyBatch(body.headlines);
        const stats = getClassificationStats(batchResult.results);
        return res.status(200).json({
          ...batchResult,
          stats,
        });
      }

      // Clear cache action
      if (body.action === 'clearCache') {
        const result = clearCache();
        return res.status(200).json(result);
      }

      return res.status(400).json({
        error: 'Invalid request. Provide "headline" (string) or "headlines" (array).',
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('classify-headlines error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}

module.exports = handler;
module.exports.classify = classify;
module.exports.classifyBatch = classifyBatch;
module.exports.getClassificationStats = getClassificationStats;
module.exports.clearCache = clearCache;
module.exports.CATEGORIES = CATEGORIES;
