/**
 * Crossing Counter Module
 * 
 * Tracks and analyzes maritime transit crossing events at chokepoints.
 * Provides real-time counting, statistical analysis, and anomaly detection
 * for vessel traffic through strategic waterways.
 */

const {
  MARITIME_CHOKEPOINTS,
  TRANSIT_STATUS,
  THREAT_LEVELS
} = require('./chokepoints');

const CROSSING_DIRECTION = {
  NORTHBOUND: 'northbound',
  SOUTHBOUND: 'southbound',
  EASTBOUND: 'eastbound',
  WESTBOUND: 'westbound',
  UNKNOWN: 'unknown'
};

const VESSEL_CATEGORIES = {
  TANKER: 'tanker',
  CONTAINER: 'container',
  BULK_CARRIER: 'bulk_carrier',
  LNG: 'lng',
  MILITARY: 'military',
  PASSENGER: 'passenger',
  FISHING: 'fishing',
  OTHER: 'other'
};

/**
 * Tracks crossing events for a single maritime chokepoint
 */
class CrossingCounter {
  constructor(chokepointId, options = {}) {
    this.chokepointId = chokepointId;
    this.options = {
      windowSizeMs: options.windowSizeMs || 24 * 60 * 60 * 1000, // 24 hours
      anomalyThreshold: options.anomalyThreshold || 2.0, // std deviations
      maxHistorySize: options.maxHistorySize || 100000,
      ...options
    };

    this.crossings = [];
    this.dailyCounts = new Map();
    this.hourlyCounts = new Map();
    this.categoryCounts = new Map();
    this.directionCounts = new Map();
    this.flagCounts = new Map();
    this._anomalies = [];
  }

  /**
   * Record a new vessel crossing event at the chokepoint
   */
  recordCrossing(crossingData) {
    if (!crossingData || !crossingData.vesselMmsi) {
      throw new Error('Vessel MMSI is required for crossing record');
    }

    const record = {
      id: `cx-${this.chokepointId}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      chokepointId: this.chokepointId,
      vesselMmsi: crossingData.vesselMmsi,
      vesselName: crossingData.vesselName || 'Unknown',
      vesselType: crossingData.vesselType || VESSEL_CATEGORIES.OTHER,
      direction: crossingData.direction || CROSSING_DIRECTION.UNKNOWN,
      flag: crossingData.flag || 'unknown',
      speed: crossingData.speed || null,
      draft: crossingData.draft || null,
      cargo: crossingData.cargo || null,
      timestamp: crossingData.timestamp || new Date().toISOString(),
      transitStatus: TRANSIT_STATUS.COMPLETED,
      metadata: crossingData.metadata || {}
    };

    this.crossings.push(record);

    // Enforce maximum history size
    if (this.crossings.length > this.options.maxHistorySize) {
      this.crossings = this.crossings.slice(-this.options.maxHistorySize);
    }

    this._updateAggregates(record);
    this._checkForAnomalies(record);

    return record;
  }

  /**
   * Get total crossing count within a time window
   */
  getCount(windowMs = null) {
    const window = windowMs || this.options.windowSizeMs;
    const cutoff = new Date(Date.now() - window).toISOString();
    return this.crossings.filter(c => c.timestamp >= cutoff).length;
  }

  /**
   * Get maritime crossing counts grouped by vessel category
   */
  getCountsByCategory(windowMs = null) {
    const window = windowMs || this.options.windowSizeMs;
    const cutoff = new Date(Date.now() - window).toISOString();
    const filtered = this.crossings.filter(c => c.timestamp >= cutoff);

    const counts = {};
    for (const category of Object.values(VESSEL_CATEGORIES)) {
      counts[category] = filtered.filter(c => c.vesselType === category).length;
    }
    return counts;
  }

  /**
   * Get crossing counts by transit direction
   */
  getCountsByDirection(windowMs = null) {
    const window = windowMs || this.options.windowSizeMs;
    const cutoff = new Date(Date.now() - window).toISOString();
    const filtered = this.crossings.filter(c => c.timestamp >= cutoff);

    const counts = {};
    for (const dir of Object.values(CROSSING_DIRECTION)) {
      counts[dir] = filtered.filter(c => c.direction === dir).length;
    }
    return counts;
  }

  /**
   * Get crossing counts by vessel flag state
   */
  getCountsByFlag(windowMs = null, topN = 20) {
    const window = windowMs || this.options.windowSizeMs;
    const cutoff = new Date(Date.now() - window).toISOString();
    const filtered = this.crossings.filter(c => c.timestamp >= cutoff);

    const flagMap = {};
    for (const crossing of filtered) {
      flagMap[crossing.flag] = (flagMap[crossing.flag] || 0) + 1;
    }

    return Object.entries(flagMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .reduce((obj, [flag, count]) => {
        obj[flag] = count;
        return obj;
      }, {});
  }

  /**
   * Calculate hourly transit rate for the chokepoint
   */
  getHourlyRate(windowHours = 24) {
    const windowMs = windowHours * 60 * 60 * 1000;
    const count = this.getCount(windowMs);
    return count / windowHours;
  }

  /**
   * Generate statistical summary of maritime crossing activity
   */
  getStatistics(windowMs = null) {
    const window = windowMs || this.options.windowSizeMs;
    const cutoff = new Date(Date.now() - window).toISOString();
    const filtered = this.crossings.filter(c => c.timestamp >= cutoff);

    if (filtered.length === 0) {
      return {
        chokepointId: this.chokepointId,
        period: { windowMs: window, from: cutoff, to: new Date().toISOString() },
        totalCrossings: 0,
        avgSpeed: null,
        avgDraft: null,
        byCategory: {},
        byDirection: {},
        byFlag: {},
        anomalies: []
      };
    }

    const speeds = filtered.filter(c => c.speed !== null).map(c => c.speed);
    const drafts = filtered.filter(c => c.draft !== null).map(c => c.draft);

    return {
      chokepointId: this.chokepointId,
      period: {
        windowMs: window,
        from: cutoff,
        to: new Date().toISOString()
      },
      totalCrossings: filtered.length,
      avgSpeed: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
      avgDraft: drafts.length > 0 ? drafts.reduce((a, b) => a + b, 0) / drafts.length : null,
      maxSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
      minSpeed: speeds.length > 0 ? Math.min(...speeds) : null,
      byCategory: this.getCountsByCategory(window),
      byDirection: this.getCountsByDirection(window),
      byFlag: this.getCountsByFlag(window, 10),
      hourlyRate: this.getHourlyRate(window / (60 * 60 * 1000)),
      anomalies: this._anomalies.filter(a => a.timestamp >= cutoff)
    };
  }

  /**
   * Get recent crossing records for maritime intelligence review
   */
  getRecentCrossings(limit = 50) {
    return this.crossings.slice(-limit).reverse();
  }

  /**
   * Search crossings by vessel name, MMSI, or flag
   */
  searchCrossings(query) {
    const q = (query || '').toLowerCase();
    return this.crossings.filter(c =>
      c.vesselName.toLowerCase().includes(q) ||
      c.vesselMmsi.toString().includes(q) ||
      c.flag.toLowerCase().includes(q)
    );
  }

  /**
   * Get detected crossing anomalies
   */
  getAnomalies(limit = 20) {
    return this._anomalies.slice(-limit);
  }

  /**
   * Reset all crossing counters
   */
  reset() {
    this.crossings = [];
    this.dailyCounts.clear();
    this.hourlyCounts.clear();
    this.categoryCounts.clear();
    this.directionCounts.clear();
    this.flagCounts.clear();
    this._anomalies = [];
  }

  _updateAggregates(record) {
    const date = record.timestamp.substring(0, 10); // YYYY-MM-DD
    const hour = record.timestamp.substring(0, 13);  // YYYY-MM-DDTHH

    this.dailyCounts.set(date, (this.dailyCounts.get(date) || 0) + 1);
    this.hourlyCounts.set(hour, (this.hourlyCounts.get(hour) || 0) + 1);
    this.categoryCounts.set(record.vesselType,
      (this.categoryCounts.get(record.vesselType) || 0) + 1);
    this.directionCounts.set(record.direction,
      (this.directionCounts.get(record.direction) || 0) + 1);
    this.flagCounts.set(record.flag,
      (this.flagCounts.get(record.flag) || 0) + 1);
  }

  _checkForAnomalies(record) {
    // Check for unusual hourly rate spikes
    const currentHour = record.timestamp.substring(0, 13);
    const currentHourCount = this.hourlyCounts.get(currentHour) || 0;

    const hourlyValues = Array.from(this.hourlyCounts.values());
    if (hourlyValues.length >= 3) {
      const mean = hourlyValues.reduce((a, b) => a + b, 0) / hourlyValues.length;
      const variance = hourlyValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / hourlyValues.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev > 0 && (currentHourCount - mean) / stdDev > this.options.anomalyThreshold) {
        const anomaly = {
          id: `anomaly-${this.chokepointId}-${Date.now()}`,
          type: 'traffic_spike',
          chokepointId: this.chokepointId,
          description: `Unusual maritime traffic spike at chokepoint: ${currentHourCount} crossings vs avg ${mean.toFixed(1)}`,
          hourlyCount: currentHourCount,
          mean: mean,
          stdDev: stdDev,
          deviations: ((currentHourCount - mean) / stdDev).toFixed(2),
          timestamp: record.timestamp,
          triggeringCrossing: record.id
        };
        this._anomalies.push(anomaly);
      }
    }

    // Check for unusual vessel speed
    if (record.speed !== null && record.speed > 25) {
      this._anomalies.push({
        id: `anomaly-speed-${this.chokepointId}-${Date.now()}`,
        type: 'high_speed_transit',
        chokepointId: this.chokepointId,
        description: `High-speed maritime crossing detected: ${record.speed} knots`,
        vessel: record.vesselName,
        mmsi: record.vesselMmsi,
        speed: record.speed,
        timestamp: record.timestamp,
        triggeringCrossing: record.id
      });
    }
  }
}

/**
 * Global crossing counter registry managing all chokepoint counters
 */
class CrossingCounterRegistry {
  constructor() {
    this.counters = new Map();
  }

  /**
   * Initialize counters for all known maritime chokepoints
   */
  initializeAll(options = {}) {
    for (const cp of Object.values(MARITIME_CHOKEPOINTS)) {
      if (!this.counters.has(cp.id)) {
        this.counters.set(cp.id, new CrossingCounter(cp.id, options));
      }
    }
    return this;
  }

  /**
   * Get or create a crossing counter for a chokepoint
   */
  getCounter(chokepointId) {
    if (!this.counters.has(chokepointId)) {
      this.counters.set(chokepointId, new CrossingCounter(chokepointId));
    }
    return this.counters.get(chokepointId);
  }

  /**
   * Get global maritime transit statistics across all chokepoints
   */
  getGlobalStatistics(windowMs = null) {
    const stats = {};
    let totalCrossings = 0;

    for (const [id, counter] of this.counters) {
      const counterStats = counter.getStatistics(windowMs);
      stats[id] = counterStats;
      totalCrossings += counterStats.totalCrossings;
    }

    return {
      timestamp: new Date().toISOString(),
      totalMonitoredChokepoints: this.counters.size,
      totalGlobalCrossings: totalCrossings,
      chokepoints: stats
    };
  }

  /**
   * Get all detected anomalies across the maritime transit network
   */
  getAllAnomalies(limit = 50) {
    const allAnomalies = [];
    for (const counter of this.counters.values()) {
      allAnomalies.push(...counter.getAnomalies());
    }
    return allAnomalies
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Reset all counters
   */
  resetAll() {
    for (const counter of this.counters.values()) {
      counter.reset();
    }
  }
}

module.exports = {
  CROSSING_DIRECTION,
  VESSEL_CATEGORIES,
  CrossingCounter,
  CrossingCounterRegistry
};
