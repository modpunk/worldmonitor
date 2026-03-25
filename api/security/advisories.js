/**
 * Security Advisories Aggregation System
 * 
 * Provides endpoints and utilities for aggregating security advisories
 * from government and other authoritative sources via RSS feeds.
 */

const { feedAggregator } = require('./feed-aggregator');

// In-memory cache for security advisories
let advisoriesCache = {
  data: [],
  lastUpdated: null,
  ttl: 5 * 60 * 1000, // 5 minutes
};

/**
 * Default government and security advisory RSS feed sources
 */
const DEFAULT_SOURCES = [
  {
    id: 'cisa-alerts',
    name: 'CISA Alerts',
    url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    type: 'government',
    category: 'security',
    priority: 'high',
  },
  {
    id: 'cisa-ics',
    name: 'CISA ICS Advisories',
    url: 'https://www.cisa.gov/cybersecurity-advisories/ics.xml',
    type: 'government',
    category: 'security',
    priority: 'high',
  },
  {
    id: 'nist-nvd',
    name: 'NIST National Vulnerability Database',
    url: 'https://nvd.nist.gov/feeds/xml/cve/misc/nvd-rss.xml',
    type: 'government',
    category: 'security',
    priority: 'high',
  },
  {
    id: 'us-cert',
    name: 'US-CERT Current Activity',
    url: 'https://www.us-cert.gov/ncas/current-activity.xml',
    type: 'government',
    category: 'security',
    priority: 'medium',
  },
  {
    id: 'cert-cc',
    name: 'CERT/CC Vulnerability Notes',
    url: 'https://www.kb.cert.org/vulfeed',
    type: 'government',
    category: 'security',
    priority: 'medium',
  },
];

/**
 * Severity classification based on keywords in advisory content
 */
const SEVERITY_KEYWORDS = {
  critical: ['critical', 'emergency', 'zero-day', '0-day', 'remote code execution', 'rce', 'actively exploited'],
  high: ['high', 'important', 'privilege escalation', 'authentication bypass', 'data breach'],
  medium: ['medium', 'moderate', 'denial of service', 'dos', 'information disclosure'],
  low: ['low', 'informational', 'minor', 'cosmetic'],
};

/**
 * Classify the severity of a security advisory based on content analysis
 * @param {Object} advisory - The advisory object with title and description
 * @returns {string} Severity level: critical, high, medium, or low
 */
function classifySeverity(advisory) {
  const text = `${advisory.title || ''} ${advisory.description || ''}`.toLowerCase();

  for (const [severity, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return severity;
      }
    }
  }

  return 'medium'; // default severity
}

/**
 * Normalize a raw feed item into a standardized security advisory format
 * @param {Object} item - Raw RSS feed item
 * @param {Object} source - The source configuration
 * @returns {Object} Normalized advisory object
 */
function normalizeAdvisory(item, source) {
  const advisory = {
    id: item.guid || item.id || `${source.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: item.title || 'Untitled Advisory',
    description: item.description || item.summary || '',
    link: item.link || item.url || '',
    publishedAt: item.pubDate || item.published || item.date || new Date().toISOString(),
    source: {
      id: source.id,
      name: source.name,
      type: source.type,
    },
    category: source.category || 'security',
    severity: null,
    tags: [],
  };

  advisory.severity = classifySeverity(advisory);
  advisory.tags = extractTags(advisory);

  return advisory;
}

/**
 * Extract relevant tags from advisory content
 * @param {Object} advisory - The advisory object
 * @returns {string[]} Array of tags
 */
function extractTags(advisory) {
  const tags = new Set();
  const text = `${advisory.title} ${advisory.description}`.toLowerCase();

  const tagPatterns = [
    { pattern: /cve-\d{4}-\d+/gi, prefix: '' },
    { pattern: /windows/gi, tag: 'windows' },
    { pattern: /linux/gi, tag: 'linux' },
    { pattern: /macos|mac os/gi, tag: 'macos' },
    { pattern: /android/gi, tag: 'android' },
    { pattern: /ios/gi, tag: 'ios' },
    { pattern: /ransomware/gi, tag: 'ransomware' },
    { pattern: /phishing/gi, tag: 'phishing' },
    { pattern: /malware/gi, tag: 'malware' },
    { pattern: /firmware/gi, tag: 'firmware' },
    { pattern: /ics|scada|industrial/gi, tag: 'industrial-control-systems' },
  ];

  for (const { pattern, tag, prefix } of tagPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      if (tag) {
        tags.add(tag);
      } else {
        matches.forEach((m) => tags.add(`${prefix || ''}${m.toUpperCase()}`));
      }
    }
  }

  if (advisory.source.type === 'government') {
    tags.add('government');
  }

  tags.add('security');

  return Array.from(tags);
}

/**
 * Check if the advisories cache is still valid
 * @returns {boolean}
 */
function isCacheValid() {
  if (!advisoriesCache.lastUpdated) return false;
  return (Date.now() - advisoriesCache.lastUpdated) < advisoriesCache.ttl;
}

/**
 * Get all aggregated security advisories
 * @param {Object} options - Query options
 * @param {string} [options.severity] - Filter by severity
 * @param {string} [options.source] - Filter by source id
 * @param {string} [options.category] - Filter by category
 * @param {number} [options.limit=50] - Max number of results
 * @param {number} [options.offset=0] - Pagination offset
 * @param {boolean} [options.forceRefresh=false] - Force cache refresh
 * @returns {Promise<Object>} Advisories response
 */
async function getAdvisories(options = {}) {
  const {
    severity,
    source,
    category,
    limit = 50,
    offset = 0,
    forceRefresh = false,
  } = options;

  if (!isCacheValid() || forceRefresh) {
    await refreshAdvisories();
  }

  let results = [...advisoriesCache.data];

  // Apply filters
  if (severity) {
    results = results.filter((a) => a.severity === severity);
  }
  if (source) {
    results = results.filter((a) => a.source.id === source);
  }
  if (category) {
    results = results.filter((a) => a.category === category);
  }

  // Sort by published date descending
  results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const total = results.length;
  const paginatedResults = results.slice(offset, offset + limit);

  return {
    advisories: paginatedResults,
    meta: {
      total,
      limit,
      offset,
      lastUpdated: advisoriesCache.lastUpdated,
      sources: DEFAULT_SOURCES.length,
    },
  };
}

/**
 * Refresh the advisories cache by fetching from all RSS sources
 * @param {Object[]} [sources] - Optional custom sources array
 * @returns {Promise<void>}
 */
async function refreshAdvisories(sources) {
  const feedSources = sources || DEFAULT_SOURCES;

  try {
    const allAdvisories = await feedAggregator.aggregateFeeds(feedSources, {
      normalize: normalizeAdvisory,
      timeout: 15000,
      concurrency: 3,
    });

    // Deduplicate by id
    const seen = new Set();
    const deduplicated = [];
    for (const advisory of allAdvisories) {
      if (!seen.has(advisory.id)) {
        seen.add(advisory.id);
        deduplicated.push(advisory);
      }
    }

    advisoriesCache.data = deduplicated;
    advisoriesCache.lastUpdated = Date.now();
  } catch (error) {
    console.error('[security/advisories] Failed to refresh advisories:', error.message);
    // Keep stale cache if refresh fails
    if (!advisoriesCache.data.length) {
      advisoriesCache.data = [];
      advisoriesCache.lastUpdated = Date.now();
    }
  }
}

/**
 * Get a single advisory by ID
 * @param {string} advisoryId
 * @returns {Promise<Object|null>}
 */
async function getAdvisoryById(advisoryId) {
  if (!isCacheValid()) {
    await refreshAdvisories();
  }

  return advisoriesCache.data.find((a) => a.id === advisoryId) || null;
}

/**
 * Get summary statistics of current security advisories
 * @returns {Promise<Object>}
 */
async function getAdvisorySummary() {
  if (!isCacheValid()) {
    await refreshAdvisories();
  }

  const data = advisoriesCache.data;

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const bySource = {};
  const recentCVEs = new Set();

  for (const advisory of data) {
    bySeverity[advisory.severity] = (bySeverity[advisory.severity] || 0) + 1;

    const srcName = advisory.source.name;
    bySource[srcName] = (bySource[srcName] || 0) + 1;

    for (const tag of advisory.tags) {
      if (tag.startsWith('CVE-')) {
        recentCVEs.add(tag);
      }
    }
  }

  return {
    total: data.length,
    bySeverity,
    bySource,
    recentCVECount: recentCVEs.size,
    lastUpdated: advisoriesCache.lastUpdated,
  };
}

/**
 * Clear the advisories cache
 */
function clearCache() {
  advisoriesCache.data = [];
  advisoriesCache.lastUpdated = null;
}

/**
 * Update cache TTL
 * @param {number} ttlMs - TTL in milliseconds
 */
function setCacheTTL(ttlMs) {
  advisoriesCache.ttl = ttlMs;
}

module.exports = {
  getAdvisories,
  getAdvisoryById,
  getAdvisorySummary,
  refreshAdvisories,
  clearCache,
  setCacheTTL,
  classifySeverity,
  normalizeAdvisory,
  extractTags,
  DEFAULT_SOURCES,
  SEVERITY_KEYWORDS,
};
