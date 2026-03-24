/**
 * Chokepoint Transit Intelligence System
 * 
 * Provides maritime chokepoint monitoring, transit tracking, and intelligence
 * analysis for strategic waterways and narrow passages.
 */

const MARITIME_CHOKEPOINTS = {
  SUEZ_CANAL: {
    id: 'suez',
    name: 'Suez Canal',
    region: 'Middle East',
    coordinates: { lat: 30.4550, lng: 32.3500 },
    maxBeam: 77.5, // meters
    maxDraft: 20.1, // meters
    avgTransitTime: 12, // hours
    annualTransits: 19000,
    strategicImportance: 'critical'
  },
  STRAIT_OF_HORMUZ: {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    region: 'Persian Gulf',
    coordinates: { lat: 26.5667, lng: 56.2500 },
    widthNm: 21,
    avgTransitTime: 2,
    annualTransits: 21000,
    strategicImportance: 'critical'
  },
  STRAIT_OF_MALACCA: {
    id: 'malacca',
    name: 'Strait of Malacca',
    region: 'Southeast Asia',
    coordinates: { lat: 2.5000, lng: 101.0000 },
    widthNm: 1.5,
    avgTransitTime: 18,
    annualTransits: 83000,
    strategicImportance: 'critical'
  },
  PANAMA_CANAL: {
    id: 'panama',
    name: 'Panama Canal',
    region: 'Central America',
    coordinates: { lat: 9.0800, lng: -79.6800 },
    maxBeam: 51.25,
    maxDraft: 15.2,
    avgTransitTime: 10,
    annualTransits: 14000,
    strategicImportance: 'high'
  },
  BAB_EL_MANDEB: {
    id: 'bab_el_mandeb',
    name: 'Bab el-Mandeb',
    region: 'Red Sea',
    coordinates: { lat: 12.5833, lng: 43.3333 },
    widthNm: 18,
    avgTransitTime: 1.5,
    annualTransits: 25000,
    strategicImportance: 'critical'
  },
  DANISH_STRAITS: {
    id: 'danish_straits',
    name: 'Danish Straits',
    region: 'Northern Europe',
    coordinates: { lat: 55.6761, lng: 12.5683 },
    widthNm: 2.5,
    avgTransitTime: 4,
    annualTransits: 60000,
    strategicImportance: 'high'
  },
  STRAIT_OF_GIBRALTAR: {
    id: 'gibraltar',
    name: 'Strait of Gibraltar',
    region: 'Mediterranean',
    coordinates: { lat: 35.9667, lng: -5.5000 },
    widthNm: 7.7,
    avgTransitTime: 1,
    annualTransits: 70000,
    strategicImportance: 'high'
  },
  BOSPHORUS: {
    id: 'bosphorus',
    name: 'Bosphorus Strait',
    region: 'Turkey',
    coordinates: { lat: 41.1190, lng: 29.0750 },
    widthNm: 0.4,
    avgTransitTime: 2,
    annualTransits: 42000,
    strategicImportance: 'high'
  }
};

const THREAT_LEVELS = {
  NONE: 0,
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL: 4
};

const TRANSIT_STATUS = {
  APPROACHING: 'approaching',
  IN_TRANSIT: 'in_transit',
  COMPLETED: 'completed',
  DELAYED: 'delayed',
  BLOCKED: 'blocked'
};

/**
 * Represents a chokepoint monitoring station with real-time transit tracking
 */
class ChokepointMonitor {
  constructor(chokepointConfig) {
    this.config = chokepointConfig;
    this.activeTransits = new Map();
    this.transitHistory = [];
    this.threatLevel = THREAT_LEVELS.NONE;
    this.alerts = [];
    this.listeners = new Map();
    this._lastUpdate = null;
  }

  get id() {
    return this.config.id;
  }

  get name() {
    return this.config.name;
  }

  /**
   * Register a maritime vessel transit through the chokepoint
   */
  registerTransit(vesselData) {
    if (!vesselData || !vesselData.mmsi) {
      throw new Error('Valid vessel data with MMSI required for transit registration');
    }

    const transitRecord = {
      id: `${this.config.id}-${vesselData.mmsi}-${Date.now()}`,
      chokepointId: this.config.id,
      vessel: {
        mmsi: vesselData.mmsi,
        imo: vesselData.imo || null,
        name: vesselData.name || 'Unknown',
        type: vesselData.type || 'unknown',
        flag: vesselData.flag || 'unknown',
        beam: vesselData.beam || null,
        draft: vesselData.draft || null
      },
      status: TRANSIT_STATUS.APPROACHING,
      entryTime: null,
      exitTime: null,
      registeredAt: new Date().toISOString(),
      estimatedTransitHours: this.config.avgTransitTime,
      metadata: vesselData.metadata || {}
    };

    // Validate vessel dimensions against chokepoint constraints
    const dimensionCheck = this._validateVesselDimensions(vesselData);
    if (!dimensionCheck.valid) {
      transitRecord.warnings = dimensionCheck.warnings;
    }

    this.activeTransits.set(transitRecord.id, transitRecord);
    this._emit('transit:registered', transitRecord);
    this._lastUpdate = new Date().toISOString();

    return transitRecord;
  }

  /**
   * Update the status of an active transit crossing
   */
  updateTransitStatus(transitId, newStatus, metadata = {}) {
    const transit = this.activeTransits.get(transitId);
    if (!transit) {
      throw new Error(`Transit crossing ${transitId} not found in active transits`);
    }

    const previousStatus = transit.status;
    transit.status = newStatus;

    if (newStatus === TRANSIT_STATUS.IN_TRANSIT && !transit.entryTime) {
      transit.entryTime = new Date().toISOString();
    }

    if (newStatus === TRANSIT_STATUS.COMPLETED) {
      transit.exitTime = new Date().toISOString();
      this.activeTransits.delete(transitId);
      this.transitHistory.push(transit);
    }

    Object.assign(transit.metadata, metadata);
    this._emit('transit:updated', { transit, previousStatus, newStatus });
    this._lastUpdate = new Date().toISOString();

    return transit;
  }

  /**
   * Set the maritime threat level for this chokepoint
   */
  setThreatLevel(level, reason = '') {
    if (level < THREAT_LEVELS.NONE || level > THREAT_LEVELS.CRITICAL) {
      throw new Error(`Invalid threat level: ${level}`);
    }

    const previous = this.threatLevel;
    this.threatLevel = level;

    if (level > previous) {
      const alert = {
        id: `alert-${this.config.id}-${Date.now()}`,
        type: 'threat_escalation',
        chokepointId: this.config.id,
        previousLevel: previous,
        newLevel: level,
        reason,
        timestamp: new Date().toISOString()
      };
      this.alerts.push(alert);
      this._emit('threat:escalated', alert);
    }

    this._lastUpdate = new Date().toISOString();
    return { previous, current: level, reason };
  }

  /**
   * Get current maritime intelligence summary for this chokepoint
   */
  getIntelligenceSummary() {
    return {
      chokepoint: this.config,
      status: {
        threatLevel: this.threatLevel,
        activeTransits: this.activeTransits.size,
        recentAlerts: this.alerts.slice(-10),
        lastUpdate: this._lastUpdate
      },
      metrics: {
        totalHistoricalTransits: this.transitHistory.length,
        activeVessels: Array.from(this.activeTransits.values()).map(t => ({
          name: t.vessel.name,
          status: t.status,
          mmsi: t.vessel.mmsi
        })),
        delayedTransits: Array.from(this.activeTransits.values())
          .filter(t => t.status === TRANSIT_STATUS.DELAYED).length,
        blockedTransits: Array.from(this.activeTransits.values())
          .filter(t => t.status === TRANSIT_STATUS.BLOCKED).length
      }
    };
  }

  /**
   * Subscribe to chokepoint events
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const cbs = this.listeners.get(event);
    if (cbs) {
      this.listeners.set(event, cbs.filter(cb => cb !== callback));
    }
  }

  _emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    cbs.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error(`Error in chokepoint event handler for ${event}:`, err);
      }
    });
  }

  _validateVesselDimensions(vesselData) {
    const warnings = [];
    let valid = true;

    if (this.config.maxBeam && vesselData.beam && vesselData.beam > this.config.maxBeam) {
      warnings.push(`Vessel beam ${vesselData.beam}m exceeds chokepoint max beam ${this.config.maxBeam}m`);
      valid = false;
    }

    if (this.config.maxDraft && vesselData.draft && vesselData.draft > this.config.maxDraft) {
      warnings.push(`Vessel draft ${vesselData.draft}m exceeds chokepoint max draft ${this.config.maxDraft}m`);
      valid = false;
    }

    return { valid, warnings };
  }
}

/**
 * Global maritime chokepoint intelligence registry
 */
class ChokepointIntelligenceSystem {
  constructor() {
    this.monitors = new Map();
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) return;

    for (const [key, config] of Object.entries(MARITIME_CHOKEPOINTS)) {
      const monitor = new ChokepointMonitor(config);
      this.monitors.set(config.id, monitor);
    }

    this._initialized = true;
    return this;
  }

  getMonitor(chokepointId) {
    return this.monitors.get(chokepointId) || null;
  }

  getAllChokepoints() {
    return Object.values(MARITIME_CHOKEPOINTS);
  }

  getGlobalIntelligence() {
    const summaries = {};
    for (const [id, monitor] of this.monitors) {
      summaries[id] = monitor.getIntelligenceSummary();
    }
    return {
      timestamp: new Date().toISOString(),
      totalMonitoredChokepoints: this.monitors.size,
      chokepoints: summaries
    };
  }

  getChokepointsByRegion(region) {
    return Object.values(MARITIME_CHOKEPOINTS)
      .filter(cp => cp.region.toLowerCase().includes(region.toLowerCase()));
  }

  getCriticalChokepoints() {
    return Object.values(MARITIME_CHOKEPOINTS)
      .filter(cp => cp.strategicImportance === 'critical');
  }
}

module.exports = {
  MARITIME_CHOKEPOINTS,
  THREAT_LEVELS,
  TRANSIT_STATUS,
  ChokepointMonitor,
  ChokepointIntelligenceSystem
};
