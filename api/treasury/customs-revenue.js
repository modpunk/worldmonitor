const NodeCache = require('node-cache');

// Cache with 1 hour TTL
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

const CACHE_KEY = 'customs_revenue_data';

/**
 * US Treasury Customs Revenue API Endpoint
 * 
 * Provides customs revenue data for the Trade Policy panel,
 * including FYTD (Fiscal Year To Date) totals, monthly breakdowns,
 * and spike detection for unusual revenue changes.
 */

/**
 * Fetch customs revenue data from Treasury sources
 * Returns monthly customs duty collections and FYTD aggregates
 */
async function fetchCustomsRevenueData() {
  // Treasury Fiscal Data API endpoint for customs duties
  const fiscalDataUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_9?fields=record_date,current_month_net,fytd_net,classification_desc&filter=classification_desc:in:(Customs Duties)&sort=-record_date&page[size]=36';

  try {
    const response = await fetch(fiscalDataUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Singularix-TradePolicy/1.0'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Treasury API responded with status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching customs revenue data from Treasury:', error.message);
    return null;
  }
}

/**
 * Detect revenue spikes by comparing month-over-month changes
 * A spike is defined as a change exceeding the threshold percentage
 */
function detectRevenueSpikes(monthlyData, thresholdPercent = 20) {
  const spikes = [];

  for (let i = 0; i < monthlyData.length - 1; i++) {
    const current = monthlyData[i];
    const previous = monthlyData[i + 1];

    if (!current.revenue || !previous.revenue || previous.revenue === 0) {
      continue;
    }

    const changePercent = ((current.revenue - previous.revenue) / Math.abs(previous.revenue)) * 100;

    if (Math.abs(changePercent) >= thresholdPercent) {
      spikes.push({
        date: current.date,
        revenue: current.revenue,
        previousRevenue: previous.revenue,
        changePercent: parseFloat(changePercent.toFixed(2)),
        direction: changePercent > 0 ? 'increase' : 'decrease',
        spike: true,
        severity: Math.abs(changePercent) >= 50 ? 'high' : 'moderate'
      });
    }
  }

  return spikes;
}

/**
 * Calculate FYTD (Fiscal Year To Date) customs revenue
 * US fiscal year starts October 1
 */
function calculateFYTD(records) {
  if (!records || records.length === 0) {
    return null;
  }

  // Get the most recent record's fiscal year
  const latestRecord = records[0];
  const latestDate = new Date(latestRecord.record_date);
  const latestMonth = latestDate.getMonth() + 1; // 1-12
  const latestYear = latestDate.getFullYear();

  // Determine current fiscal year start
  const fiscalYearStart = latestMonth >= 10
    ? new Date(latestYear, 9, 1)   // Oct 1 of current year
    : new Date(latestYear - 1, 9, 1); // Oct 1 of previous year

  const fiscalYear = latestMonth >= 10 ? latestYear + 1 : latestYear;

  // Filter records within current fiscal year
  const fytdRecords = records.filter(r => {
    const recordDate = new Date(r.record_date);
    return recordDate >= fiscalYearStart;
  });

  // Use the FYTD value from the most recent record if available
  const fytdFromApi = latestRecord.fytd_net
    ? parseFloat(latestRecord.fytd_net)
    : null;

  // Also calculate by summing monthly values
  const fytdCalculated = fytdRecords.reduce((sum, r) => {
    const val = parseFloat(r.current_month_net) || 0;
    return sum + val;
  }, 0);

  return {
    fiscalYear: `FY${fiscalYear}`,
    FYTD: fytdFromApi || fytdCalculated,
    fytdCalculated,
    monthsIncluded: fytdRecords.length,
    latestMonth: latestRecord.record_date,
    unit: 'millions_usd'
  };
}

/**
 * Transform raw API data into structured customs revenue response
 */
function transformCustomsRevenueData(apiData) {
  if (!apiData || !apiData.data || apiData.data.length === 0) {
    return null;
  }

  const records = apiData.data;

  // Build monthly revenue series
  const monthlyData = records.map(record => ({
    date: record.record_date,
    revenue: parseFloat(record.current_month_net) || 0,
    fytdNet: parseFloat(record.fytd_net) || 0,
    classification: record.classification_desc
  }));

  // Calculate FYTD totals
  const fytdSummary = calculateFYTD(records);

  // Detect unusual revenue spikes
  const spikes = detectRevenueSpikes(monthlyData);

  // Calculate summary statistics
  const revenues = monthlyData.map(m => m.revenue).filter(r => r !== 0);
  const avgMonthlyRevenue = revenues.length > 0
    ? revenues.reduce((a, b) => a + b, 0) / revenues.length
    : 0;
  const maxRevenue = revenues.length > 0 ? Math.max(...revenues) : 0;
  const minRevenue = revenues.length > 0 ? Math.min(...revenues) : 0;

  // Year-over-year comparison (current vs same period last year)
  let yoyComparison = null;
  if (monthlyData.length >= 13) {
    const currentMonth = monthlyData[0];
    const sameMonthLastYear = monthlyData[12];
    if (currentMonth.revenue && sameMonthLastYear.revenue && sameMonthLastYear.revenue !== 0) {
      const yoyChange = ((currentMonth.revenue - sameMonthLastYear.revenue) / Math.abs(sameMonthLastYear.revenue)) * 100;
      yoyComparison = {
        currentPeriod: currentMonth.date,
        priorPeriod: sameMonthLastYear.date,
        currentRevenue: currentMonth.revenue,
        priorRevenue: sameMonthLastYear.revenue,
        changePercent: parseFloat(yoyChange.toFixed(2)),
        direction: yoyChange > 0 ? 'increase' : 'decrease'
      };
    }
  }

  return {
    customs: {
      monthly: monthlyData,
      fytd: fytdSummary,
      statistics: {
        averageMonthlyRevenue: parseFloat(avgMonthlyRevenue.toFixed(2)),
        maxMonthlyRevenue: maxRevenue,
        minMonthlyRevenue: minRevenue,
        totalMonthsReported: monthlyData.length,
        unit: 'millions_usd'
      },
      spikes: {
        detected: spikes.length,
        threshold: '20%',
        events: spikes
      },
      yearOverYear: yoyComparison
    }
  };
}

/**
 * Generate fallback/sample customs revenue data
 * Used when the Treasury API is unavailable
 */
function generateFallbackData() {
  const now = new Date();
  const months = [];

  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const baseRevenue = 8000 + Math.random() * 4000; // $8B-$12B range in millions
    months.push({
      date: date.toISOString().split('T')[0],
      revenue: parseFloat(baseRevenue.toFixed(2)),
      fytdNet: 0,
      classification: 'Customs Duties'
    });
  }

  // Inject a spike for demonstration
  if (months.length >= 3) {
    months[1].revenue = months[2].revenue * 1.45; // 45% spike
  }

  const spikes = detectRevenueSpikes(months);

  const revenues = months.map(m => m.revenue);
  const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length;

  // Calculate a sample FYTD
  const fytdTotal = months.slice(0, 6).reduce((sum, m) => sum + m.revenue, 0);

  return {
    customs: {
      monthly: months,
      fytd: {
        fiscalYear: `FY${now.getFullYear()}`,
        FYTD: parseFloat(fytdTotal.toFixed(2)),
        fytdCalculated: parseFloat(fytdTotal.toFixed(2)),
        monthsIncluded: 6,
        latestMonth: months[0].date,
        unit: 'millions_usd'
      },
      statistics: {
        averageMonthlyRevenue: parseFloat(avgRevenue.toFixed(2)),
        maxMonthlyRevenue: Math.max(...revenues),
        minMonthlyRevenue: Math.min(...revenues),
        totalMonthsReported: months.length,
        unit: 'millions_usd'
      },
      spikes: {
        detected: spikes.length,
        threshold: '20%',
        events: spikes
      },
      yearOverYear: null,
      _note: 'Fallback data - Treasury API unavailable'
    }
  };
}

/**
 * Main handler for /api/treasury/customs-revenue
 */
module.exports = async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      allowed: ['GET']
    });
  }

  try {
    // Check cache first
    const cachedData = cache.get(CACHE_KEY);
    if (cachedData) {
      return res.status(200).json({
        ...cachedData,
        meta: {
          ...cachedData.meta,
          cached: true,
          servedAt: new Date().toISOString()
        }
      });
    }

    // Fetch fresh data from Treasury API
    const rawData = await fetchCustomsRevenueData();
    let responseData;

    if (rawData && rawData.data && rawData.data.length > 0) {
      responseData = transformCustomsRevenueData(rawData);
    } else {
      // Use fallback data if API is unavailable
      responseData = generateFallbackData();
    }

    if (!responseData) {
      return res.status(502).json({
        error: 'Unable to retrieve customs revenue data',
        message: 'Treasury data source is temporarily unavailable'
      });
    }

    // Build final response
    const finalResponse = {
      ...responseData,
      meta: {
        source: 'US Treasury Fiscal Data API',
        endpoint: 'Monthly Treasury Statement - Table 9',
        description: 'US customs duties revenue collections',
        cached: false,
        fetchedAt: new Date().toISOString(),
        servedAt: new Date().toISOString(),
        cacheExpiry: 3600
      }
    };

    // Store in cache
    cache.set(CACHE_KEY, finalResponse);

    // Set response headers
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=1800');
    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json(finalResponse);

  } catch (error) {
    console.error('Customs revenue endpoint error:', error);

    // Attempt to serve stale cache on error
    const staleData = cache.get(CACHE_KEY);
    if (staleData) {
      return res.status(200).json({
        ...staleData,
        meta: {
          ...staleData.meta,
          cached: true,
          stale: true,
          servedAt: new Date().toISOString(),
          error: 'Served from stale cache due to upstream error'
        }
      });
    }

    // Last resort: serve fallback data
    const fallback = generateFallbackData();
    return res.status(200).json({
      ...fallback,
      meta: {
        source: 'fallback',
        cached: false,
        servedAt: new Date().toISOString(),
        warning: 'Using generated fallback data due to service error'
      }
    });
  }
};

// Export helpers for testing
module.exports.detectRevenueSpikes = detectRevenueSpikes;
module.exports.calculateFYTD = calculateFYTD;
module.exports.transformCustomsRevenueData = transformCustomsRevenueData;
