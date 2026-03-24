/**
 * Satellite Imagery Integration Stub
 * 
 * Provides satellite imagery data for integration with globe.gl rendering system.
 * References geolocation patterns from api/geo.js for coordinate handling.
 * 
 * Supports querying imagery by GeoJSON polygon regions, filtering by
 * cloud coverage and acquisition time windows.
 */

const SUPPORTED_PROVIDERS = ['sentinel-2', 'landsat-8', 'planet'];
const DEFAULT_CLOUD_THRESHOLD = 20; // percent

/**
 * Represents a satellite imagery tile/scene metadata response.
 * @typedef {Object} ImageryResult
 * @property {string} image_url - URL to the satellite image tile
 * @property {string} acquisition_time - ISO 8601 timestamp of image capture
 * @property {number} cloud_coverage_percent - Percentage of cloud cover (0-100)
 * @property {Object} polygon - GeoJSON polygon of the image footprint
 * @property {string} provider - Satellite data provider
 * @property {string} scene_id - Unique scene identifier
 * @property {number} resolution_meters - Spatial resolution in meters
 */

/**
 * Validates a GeoJSON polygon geometry.
 * @param {Object} geojson - A GeoJSON object with polygon geometry
 * @returns {boolean} True if valid polygon
 */
function validateGeoJSONPolygon(geojson) {
  if (!geojson || typeof geojson !== 'object') {
    return false;
  }

  // Support both Feature and raw Geometry
  const geometry = geojson.type === 'Feature' ? geojson.geometry : geojson;

  if (!geometry || geometry.type !== 'Polygon') {
    return false;
  }

  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    return false;
  }

  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return false;
  }

  // First and last coordinate must match (closed ring)
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return false;
  }

  return true;
}

/**
 * Computes the bounding box of a GeoJSON polygon.
 * Compatible with globe.gl coordinate system.
 * @param {Object} polygon - GeoJSON Polygon geometry
 * @returns {Object} Bounding box { west, south, east, north }
 */
function computeBoundingBox(polygon) {
  const geometry = polygon.type === 'Feature' ? polygon.geometry : polygon;
  const coords = geometry.coordinates[0];

  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;

  for (const [lng, lat] of coords) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  return { west, south, east, north };
}

/**
 * Query satellite imagery for a given GeoJSON polygon region.
 * 
 * @param {Object} options
 * @param {Object} options.polygon - GeoJSON polygon defining the area of interest
 * @param {string} [options.startDate] - ISO 8601 start date for acquisition_time window
 * @param {string} [options.endDate] - ISO 8601 end date for acquisition_time window
 * @param {number} [options.maxCloudCoverage=20] - Maximum cloud_coverage_percent threshold
 * @param {string} [options.provider] - Satellite provider filter
 * @param {number} [options.limit=10] - Maximum number of results
 * @returns {Promise<{results: ImageryResult[], metadata: Object}>}
 */
async function queryImagery(options = {}) {
  const {
    polygon,
    startDate,
    endDate,
    maxCloudCoverage = DEFAULT_CLOUD_THRESHOLD,
    provider,
    limit = 10,
  } = options;

  if (!polygon) {
    throw new Error('A GeoJSON polygon is required to query satellite imagery');
  }

  if (!validateGeoJSONPolygon(polygon)) {
    throw new Error('Invalid GeoJSON polygon geometry. Must be a valid Polygon or Feature with Polygon geometry.');
  }

  if (provider && !SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }

  if (maxCloudCoverage < 0 || maxCloudCoverage > 100) {
    throw new Error('cloud_coverage_percent threshold must be between 0 and 100');
  }

  const bbox = computeBoundingBox(polygon);

  // Stub: Build the request payload that would be sent to imagery API
  const requestPayload = {
    bbox,
    polygon: polygon.type === 'Feature' ? polygon.geometry : polygon,
    time_range: {
      start: startDate || null,
      end: endDate || null,
    },
    filters: {
      max_cloud_coverage_percent: maxCloudCoverage,
      provider: provider || null,
    },
    limit,
  };

  // Stub response simulating satellite imagery results
  const results = _generateStubResults(requestPayload);

  return {
    results,
    metadata: {
      query_bbox: bbox,
      total_results: results.length,
      providers_queried: provider ? [provider] : SUPPORTED_PROVIDERS,
      cloud_coverage_threshold: maxCloudCoverage,
    },
  };
}

/**
 * Get a single imagery scene by its scene ID.
 * 
 * @param {string} sceneId - The unique scene identifier
 * @returns {Promise<ImageryResult|null>}
 */
async function getSceneById(sceneId) {
  if (!sceneId || typeof sceneId !== 'string') {
    throw new Error('A valid scene ID string is required');
  }

  // Stub: would call the imagery provider API
  return {
    scene_id: sceneId,
    image_url: `https://imagery.stub.example.com/scenes/${sceneId}/tile.png`,
    acquisition_time: new Date().toISOString(),
    cloud_coverage_percent: 5.2,
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.5, 37.7],
          [-122.3, 37.7],
          [-122.3, 37.9],
          [-122.5, 37.9],
          [-122.5, 37.7],
        ],
      ],
    },
    provider: 'sentinel-2',
    resolution_meters: 10,
  };
}

/**
 * Format imagery result for globe.gl layer integration.
 * Transforms imagery metadata into a format compatible with globe.gl's
 * polygons and custom layers.
 * 
 * @param {ImageryResult} scene - A satellite imagery result
 * @returns {Object} globe.gl compatible layer data
 */
function formatForGlobeGL(scene) {
  if (!scene || !scene.polygon) {
    throw new Error('Scene with valid GeoJSON polygon is required');
  }

  const geometry = scene.polygon.type === 'Feature'
    ? scene.polygon.geometry
    : scene.polygon;

  return {
    // globe.gl polygon layer format
    type: 'imagery-overlay',
    coordinates: geometry.coordinates,
    properties: {
      image_url: scene.image_url,
      acquisition_time: scene.acquisition_time,
      cloud_coverage_percent: scene.cloud_coverage_percent,
      scene_id: scene.scene_id,
      provider: scene.provider,
    },
    // globe.gl rendering hints
    altitude: 0.001, // slight elevation for overlay visibility
    opacity: scene.cloud_coverage_percent > 50 ? 0.5 : 0.85,
    sideColor: 'rgba(0, 100, 200, 0.1)',
    topColor: 'rgba(0, 100, 200, 0.3)',
  };
}

/**
 * Generate stub imagery results for development/testing.
 * @param {Object} request - The query request payload
 * @returns {ImageryResult[]}
 * @private
 */
function _generateStubResults(request) {
  const count = Math.min(request.limit || 5, 10);
  const results = [];

  for (let i = 0; i < count; i++) {
    const providerIndex = i % SUPPORTED_PROVIDERS.length;
    const selectedProvider = request.filters.provider || SUPPORTED_PROVIDERS[providerIndex];
    const daysAgo = i * 3;
    const acqDate = new Date();
    acqDate.setDate(acqDate.getDate() - daysAgo);

    const cloud_coverage_percent = parseFloat((Math.random() * (request.filters.max_cloud_coverage_percent || 20)).toFixed(1));

    results.push({
      scene_id: `STUB_${selectedProvider.toUpperCase()}_${Date.now()}_${i}`,
      image_url: `https://imagery.stub.example.com/tiles/${selectedProvider}/${i}/rgb.png`,
      acquisition_time: acqDate.toISOString(),
      cloud_coverage_percent,
      polygon: request.polygon || {
        type: 'Polygon',
        coordinates: [
          [
            [request.bbox.west, request.bbox.south],
            [request.bbox.east, request.bbox.south],
            [request.bbox.east, request.bbox.north],
            [request.bbox.west, request.bbox.north],
            [request.bbox.west, request.bbox.south],
          ],
        ],
      },
      provider: selectedProvider,
      resolution_meters: selectedProvider === 'sentinel-2' ? 10 : selectedProvider === 'landsat-8' ? 30 : 3,
    });
  }

  return results;
}

module.exports = {
  queryImagery,
  getSceneById,
  formatForGlobeGL,
  validateGeoJSONPolygon,
  computeBoundingBox,
  SUPPORTED_PROVIDERS,
  DEFAULT_CLOUD_THRESHOLD,
};
