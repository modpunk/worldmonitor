/**
 * RSS Feed Aggregator for Security Advisories
 * 
 * Handles fetching, parsing, and aggregating RSS/Atom feeds
 * from multiple government and security advisory sources.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Simple XML tag content extractor (lightweight, no external deps)
 * @param {string} xml - XML string
 * @param {string} tag - Tag name
 * @returns {string} Content of the tag
 */
function extractTagContent(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  if (!match) return '';
  return (match[1] || match[2] || '').trim();
}

/**
 * Extract all occurrences of a tag from XML
 * @param {string} xml - XML string
 * @param {string} tag - Tag name
 * @returns {string[]} Array of tag contents (raw XML blocks)
 */
function extractAllTags(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
  return xml.match(regex) || [];
}

/**
 * Extract attribute value from an XML tag
 * @param {string} xml - XML tag string
 * @param {string} attr - Attribute name
 * @returns {string} Attribute value
 */
function extractAttribute(xml, attr) {
  const regex = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : '';
}

/**
 * Parse RSS 2.0 feed XML into items
 * @param {string} xml - RSS XML content
 * @returns {Object[]} Parsed items
 */
function parseRSSFeed(xml) {
  const items = extractAllTags(xml, 'item');

  return items.map((itemXml) => ({
    title: extractTagContent(itemXml, 'title'),
    description: extractTagContent(itemXml, 'description'),
    link: extractTagContent(itemXml, 'link'),
    guid: extractTagContent(itemXml, 'guid'),
    pubDate: extractTagContent(itemXml, 'pubDate'),
    category: extractTagContent(itemXml, 'category'),
  }));
}

/**
 * Parse Atom feed XML into items
 * @param {string} xml - Atom XML content
 * @returns {Object[]} Parsed items
 */
function parseAtomFeed(xml) {
  const entries = extractAllTags(xml, 'entry');

  return entries.map((entryXml) => {
    const linkTag = (entryXml.match(/<link[^>]*\/?>/) || [''])[0];
    const link = extractAttribute(linkTag, 'href') || extractTagContent(entryXml, 'link');

    return {
      title: extractTagContent(entryXml, 'title'),
      description: extractTagContent(entryXml, 'summary') || extractTagContent(entryXml, 'content'),
      link,
      guid: extractTagContent(entryXml, 'id'),
      pubDate: extractTagContent(entryXml, 'updated') || extractTagContent(entryXml, 'published'),
    };
  });
}

/**
 * Detect feed type and parse accordingly
 * @param {string} xml - Feed XML content
 * @returns {Object[]} Parsed items
 */
function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') {
    return [];
  }

  // Detect feed type
  if (xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"')) {
    return parseAtomFeed(xml);
  }

  // Default to RSS parsing
  return parseRSSFeed(xml);
}

/**
 * Fetch a URL with timeout support
 * @param {string} url - URL to fetch
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<string>} Response body
 */
function fetchURL(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Singularix-Security-Aggregator/1.0',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      timeout,
    };

    const req = client.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchURL(res.headers.location, timeout)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        res.resume();
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve(body);
      });
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching RSS feed: ${url}`));
    });

    req.on('error', (err) => {
      reject(new Error(`Error fetching RSS feed ${url}: ${err.message}`));
    });

    req.end();
  });
}

/**
 * Per-source feed cache
 */
const feedCache = new Map();

/**
 * Fetch and parse a single RSS feed source with caching
 * @param {Object} source - Source configuration
 * @param {Object} options - Fetch options
 * @returns {Promise<Object[]>} Parsed feed items
 */
async function fetchFeed(source, options = {}) {
  const { timeout = 10000, cacheTTL = 300000 } = options;

  // Check cache
  const cached = feedCache.get(source.id);
  if (cached && (Date.now() - cached.timestamp) < cacheTTL) {
    return cached.items;
  }

  try {
    const xml = await fetchURL(source.url, timeout);
    const items = parseFeed(xml);

    // Update cache
    feedCache.set(source.id, {
      items,
      timestamp: Date.now(),
    });

    return items;
  } catch (error) {
    console.warn(`[feed-aggregator] Failed to fetch rss feed from ${source.name} (${source.url}): ${error.message}`);

    // Return stale cache if available
    if (cached) {
      console.warn(`[feed-aggregator] Using stale cache for ${source.name}`);
      return cached.items;
    }

    return [];
  }
}

/**
 * Run promises with concurrency limit
 * @param {Function[]} tasks - Array of async functions
 * @param {number} concurrency - Max concurrent tasks
 * @returns {Promise<any[]>} Results
 */
async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = Promise.resolve().then(task);
    results.push(p);
    executing.add(p);

    const cleanup = () => executing.delete(p);
    p.then(cleanup, cleanup);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

/**
 * Aggregate feeds from multiple security advisory sources
 * @param {Object[]} sources - Array of source configurations
 * @param {Object} options - Aggregation options
 * @param {Function} [options.normalize] - Normalization function(item, source) => normalizedItem
 * @param {number} [options.timeout=15000] - Fetch timeout per source
 * @param {number} [options.concurrency=3] - Max concurrent fetches
 * @param {number} [options.cacheTTL=300000] - Cache TTL in ms
 * @returns {Promise<Object[]>} Aggregated and optionally normalized items
 */
async function aggregateFeeds(sources, options = {}) {
  const {
    normalize,
    timeout = 15000,
    concurrency = 3,
    cacheTTL = 300000,
  } = options;

  const tasks = sources.map((source) => {
    return async () => {
      const items = await fetchFeed(source, { timeout, cacheTTL });

      if (normalize && typeof normalize === 'function') {
        return items.map((item) => normalize(item, source));
      }

      return items.map((item) => ({
        ...item,
        _source: source.id,
        _sourceType: source.type,
      }));
    };
  });

  const results = await runWithConcurrency(tasks, concurrency);

  const allItems = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allItems.push(...result.value);
    }
  }

  return allItems;
}

/**
 * Clear the feed cache entirely or for a specific source
 * @param {string} [sourceId] - Optional source ID to clear
 */
function clearFeedCache(sourceId) {
  if (sourceId) {
    feedCache.delete(sourceId);
  } else {
    feedCache.clear();
  }
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
function getCacheStats() {
  const stats = {
    totalCached: feedCache.size,
    sources: [],
  };

  for (const [id, entry] of feedCache.entries()) {
    stats.sources.push({
      id,
      itemCount: entry.items.length,
      cachedAt: new Date(entry.timestamp).toISOString(),
      ageMs: Date.now() - entry.timestamp,
    });
  }

  return stats;
}

// Singleton-style feed aggregator instance
const feedAggregator = {
  aggregateFeeds,
  fetchFeed,
  parseFeed,
  parseRSSFeed,
  parseAtomFeed,
  fetchURL,
  clearFeedCache,
  getCacheStats,
};

module.exports = {
  feedAggregator,
  aggregateFeeds,
  fetchFeed,
  parseFeed,
  parseRSSFeed,
  parseAtomFeed,
  fetchURL,
  clearFeedCache,
  getCacheStats,
  extractTagContent,
  extractAllTags,
  extractAttribute,
};
