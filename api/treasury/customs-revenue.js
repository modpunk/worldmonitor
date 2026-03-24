const CACHE_TTL = 3600; // 1 hour cache
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30;

const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

let cachedData = null;
let cacheTimestamp = 0;

function isCacheValid() {
  return cachedData && (Date.now() - cacheTimestamp) < CACHE_TTL * 1000;
}

function getCurrentFiscalYear() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  // US fiscal year starts October 1
  return month >= 10 ? year + 1 : year;
}

function getPreviousFiscalYear() {
  return getCurrentFiscalYear() - 1;
}

function buildTreasuryApiUrl(fiscalYear, pageSize = 1000) {
  const baseUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
  const endpoint = '/v1/accounting/mts/mts_table_4';
  const filters = `filter=classification_desc:in:(Customs),fiscal_year:eq:${fiscalYear}`;
  const fields = 'fields=record_date,classification_desc,current_month_net_rcpt_amt,fytd_net_rcpt_amt,fiscal_year,record_fiscal_year,record_fiscal_quarter,record_calendar_month';
  const sort = 'sort=-record_date';
  const pagination = `page[size]=${pageSize}`;
  return `${baseUrl}${endpoint}?${filters}&${fields}&${sort}&${pagination}`;
}

async function fetchTreasuryData(fiscalYear) {
  const url = buildTreasuryApiUrl(fiscalYear);
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Singularix-Dashboard/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Treasury API returned ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();
  return json.data || [];
}

function computeMetrics(currentYearData, previousYearData) {
  const currentFY = getCurrentFiscalYear();
  const previousFY = getPreviousFiscalYear();

  // Calculate FYTD total from current fiscal year data
  let fytd_total = 0;
  let latestMonth = null;
  let monthlyBreakdown = [];

  if (currentYearData.length > 0) {
    // Get the latest record to determine FYTD total
    const sorted = [...currentYearData].sort(
      (a, b) => new Date(b.record_date) - new Date(a.record_date)
    );

    const latestRecord = sorted[0];
    fytd_total = parseFloat(latestRecord.fytd_net_rcpt_amt || 0);
    latestMonth = latestRecord.record_date;

    // Build monthly breakdown
    const seenMonths = new Set();
    for (const record of sorted) {
      const month = record.record_calendar_month;
      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        monthlyBreakdown.push({
          month: record.record_calendar_month,
          record_date: record.record_date,
          current_month_net: parseFloat(record.current_month_net_rcpt_amt || 0),
          fytd_net: parseFloat(record.fytd_net_rcpt_amt || 0),
        });
      }
    }
  }

  // Calculate previous year FYTD for comparison
  let previous_fytd_total = 0;
  if (previousYearData.length > 0) {
    const sortedPrev = [...previousYearData].sort(
      (a, b) => new Date(b.record_date) - new Date(a.record_date)
    );

    // Try to find comparable month in previous year
    if (latestMonth && sortedPrev.length > 0) {
      const currentMonth = new Date(latestMonth).getMonth() + 1;
      const comparableRecord = sortedPrev.find(
        (r) => parseInt(r.record_calendar_month) === currentMonth
      );
      if (comparableRecord) {
        previous_fytd_total = parseFloat(comparableRecord.fytd_net_rcpt_amt || 0);
      } else {
        previous_fytd_total = parseFloat(sortedPrev[0].fytd_net_rcpt_amt || 0);
      }
    } else if (sortedPrev.length > 0) {
      previous_fytd_total = parseFloat(sortedPrev[0].fytd_net_rcpt_amt || 0);
    }
  }

  // Calculate year-over-year change
  let yoy_change_percent = null;
  if (previous_fytd_total !== 0) {
    yoy_change_percent = parseFloat(
      (((fytd_total - previous_fytd_total) / Math.abs(previous_fytd_total)) * 100).toFixed(2)
    );
  }

  // Latest monthly revenue
  let latest_monthly_revenue = 0;
  if (monthlyBreakdown.length > 0) {
    latest_monthly_revenue = monthlyBreakdown[0].current_month_net;
  }

  return {
    fiscal_year: currentFY,
    previous_fiscal_year: previousFY,
    fytd_total,
    previous_fytd_total,
    yoy_change_percent,
    latest_monthly_revenue,
    latest_record_date: latestMonth,
    monthly_breakdown: monthlyBreakdown,
    unit: 'millions_usd',
    source: 'US Treasury Fiscal Data API - Monthly Treasury Statement Table 4',
  };
}

async function fetchAndProcessData() {
  const currentFY = getCurrentFiscalYear();
  const previousFY = getPreviousFiscalYear();

  const [currentYearData, previousYearData] = await Promise.all([
    fetchTreasuryData(currentFY),
    fetchTreasuryData(previousFY),
  ]);

  return computeMetrics(currentYearData, previousYearData);
}

export default async function handler(req, res) {
  const corsHeaders = getCorsHeaders();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({
      error: 'Method not allowed',
      allowed: ['GET'],
    });
    return;
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const rateLimit = checkRateLimit(clientIp);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);

  if (!rateLimit.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retry_after_seconds: 60,
    });
    return;
  }

  try {
    let data;

    if (isCacheValid()) {
      data = cachedData;
      res.setHeader('X-Cache', 'HIT');
    } else {
      data = await fetchAndProcessData();
      cachedData = data;
      cacheTimestamp = Date.now();
      res.setHeader('X-Cache', 'MISS');
    }

    res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`);
    res.setHeader('Content-Type', 'application/json');

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cache_ttl_seconds: CACHE_TTL,
      data,
    });
  } catch (error) {
    console.error('Error fetching Treasury customs revenue data:', error);

    // Return stale cache if available
    if (cachedData) {
      res.setHeader('X-Cache', 'STALE');
      res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        stale: true,
        cache_age_seconds: Math.floor((Date.now() - cacheTimestamp) / 1000),
        data: cachedData,
      });
      return;
    }

    res.status(502).json({
      success: false,
      error: 'Failed to fetch customs revenue data from Treasury API',
      message: error.message,
    });
  }
}
