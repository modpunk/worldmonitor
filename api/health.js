const express = require('express');
const router = express.Router();

// Health check status constants
const STATUS_HEALTHY = 'healthy';
const STATUS_DEGRADED = 'degraded';
const STATUS_UNHEALTHY = 'unhealthy';

// Track bootstrap state
let bootstrapCompleted = false;
let bootstrapTimestamp = null;

function setBootstrapComplete() {
  bootstrapCompleted = true;
  bootstrapTimestamp = new Date().toISOString();
}

// Check redis connectivity
async function checkRedis(redisClient) {
  const start = Date.now();
  try {
    if (!redisClient || !redisClient.ping) {
      return { status: STATUS_UNHEALTHY, latency_ms: null, error: 'redis client not available' };
    }
    const pong = await redisClient.ping();
    const latency = Date.now() - start;
    if (pong === 'PONG') {
      return { status: STATUS_HEALTHY, latency_ms: latency };
    }
    return { status: STATUS_UNHEALTHY, latency_ms: latency, error: 'unexpected ping response' };
  } catch (err) {
    return { status: STATUS_UNHEALTHY, latency_ms: Date.now() - start, error: err.message };
  }
}

// Check seed-meta availability and integrity
async function checkSeedMeta(db) {
  const start = Date.now();
  try {
    if (!db) {
      return { status: STATUS_UNHEALTHY, latency_ms: null, error: 'seed-meta store not available' };
    }
    // Attempt to read seed-meta collection/table
    let count = 0;
    if (typeof db.collection === 'function') {
      const collection = db.collection('seed-meta');
      count = await collection.countDocuments();
    } else if (typeof db.query === 'function') {
      const result = await db.query('SELECT COUNT(*) as count FROM seed_meta');
      count = result && result[0] ? result[0].count : 0;
    } else {
      return { status: STATUS_DEGRADED, latency_ms: Date.now() - start, error: 'unknown db interface for seed-meta' };
    }
    const latency = Date.now() - start;
    return { status: STATUS_HEALTHY, latency_ms: latency, record_count: count };
  } catch (err) {
    return { status: STATUS_DEGRADED, latency_ms: Date.now() - start, error: err.message };
  }
}

// Check bootstrap status
function checkBootstrap() {
  if (bootstrapCompleted) {
    return { status: STATUS_HEALTHY, completed: true, timestamp: bootstrapTimestamp };
  }
  return { status: STATUS_DEGRADED, completed: false, timestamp: null };
}

// Compute overall health from component checks
function computeOverallHealth(components) {
  const statuses = Object.values(components).map(c => c.status);
  if (statuses.every(s => s === STATUS_HEALTHY)) {
    return STATUS_HEALTHY;
  }
  if (statuses.some(s => s === STATUS_UNHEALTHY)) {
    return STATUS_UNHEALTHY;
  }
  return STATUS_DEGRADED;
}

// Build the health router
function createHealthRouter(dependencies = {}) {
  const { redisClient, db } = dependencies;

  // Primary health endpoint - comprehensive check
  router.get('/health', async (req, res) => {
    try {
      const startTime = Date.now();

      const [redisStatus, seedMetaStatus] = await Promise.allSettled([
        checkRedis(redisClient),
        checkSeedMeta(db)
      ]);

      const components = {
        redis: redisStatus.status === 'fulfilled'
          ? redisStatus.value
          : { status: STATUS_UNHEALTHY, error: redisStatus.reason?.message || 'check failed' },
        'seed-meta': seedMetaStatus.status === 'fulfilled'
          ? seedMetaStatus.value
          : { status: STATUS_UNHEALTHY, error: seedMetaStatus.reason?.message || 'check failed' },
        bootstrap: checkBootstrap()
      };

      const overallStatus = computeOverallHealth(components);
      const responseTime = Date.now() - startTime;

      const healthResponse = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        response_time_ms: responseTime,
        components,
        version: process.env.APP_VERSION || 'unknown'
      };

      const httpStatus = overallStatus === STATUS_UNHEALTHY ? 503 : 200;
      res.status(httpStatus).json(healthResponse);
    } catch (err) {
      res.status(503).json({
        status: STATUS_UNHEALTHY,
        timestamp: new Date().toISOString(),
        error: err.message
      });
    }
  });

  // Lightweight liveness probe (no dependency checks)
  router.get('/health/live', (req, res) => {
    res.status(200).json({
      status: STATUS_HEALTHY,
      timestamp: new Date().toISOString()
    });
  });

  // Readiness probe (checks bootstrap + redis)
  router.get('/health/ready', async (req, res) => {
    try {
      const bootstrapStatus = checkBootstrap();
      const redisStatus = await checkRedis(redisClient);

      const ready = bootstrapStatus.completed && redisStatus.status === STATUS_HEALTHY;

      res.status(ready ? 200 : 503).json({
        ready,
        timestamp: new Date().toISOString(),
        components: {
          bootstrap: bootstrapStatus,
          redis: redisStatus
        }
      });
    } catch (err) {
      res.status(503).json({ ready: false, error: err.message });
    }
  });

  return router;
}

module.exports = {
  createHealthRouter,
  setBootstrapComplete,
  checkRedis,
  checkSeedMeta,
  checkBootstrap,
  STATUS_HEALTHY,
  STATUS_DEGRADED,
  STATUS_UNHEALTHY
};
