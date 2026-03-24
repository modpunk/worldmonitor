/**
 * R2 Trace Upload Module
 * 
 * Handles uploading forecast debugging traces to Cloudflare R2 storage.
 * Integrates with existing authentication patterns.
 */

const TRACE_BUCKET = 'singularix-traces';
const MAX_TRACE_SIZE = 10 * 1024 * 1024; // 10MB max trace size
const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/octet-stream',
  'text/plain',
];

/**
 * Validates the authentication token from the request.
 * Maintains consistency with existing authentication patterns.
 * @param {Request} request - The incoming request
 * @param {object} env - Environment bindings
 * @returns {object} - { valid: boolean, userId?: string, error?: string }
 */
function validateAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, error: 'Invalid Authorization format. Expected: Bearer <token>' };
  }

  const token = parts[1];
  const expectedToken = env.R2_AUTH_TOKEN || env.AUTH_TOKEN;

  if (!expectedToken) {
    return { valid: false, error: 'Server authentication not configured' };
  }

  if (token !== expectedToken) {
    return { valid: false, error: 'Invalid authentication token' };
  }

  const userId = request.headers.get('X-User-Id') || 'anonymous';
  return { valid: true, userId };
}

/**
 * Generates a unique trace key for R2 storage.
 * @param {string} traceId - The trace identifier
 * @param {string} userId - The user identifier
 * @param {string} traceType - The type of trace (e.g., 'forecast', 'debug')
 * @returns {string} - The R2 object key
 */
function generateTraceKey(traceId, userId, traceType = 'forecast') {
  const now = new Date();
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
  return `traces/${traceType}/${datePath}/${userId}/${traceId}`;
}

/**
 * Validates trace metadata before upload.
 * @param {object} metadata - Trace metadata
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateTraceMetadata(metadata) {
  if (!metadata) {
    return { valid: false, error: 'Missing trace metadata' };
  }
  if (!metadata.traceId) {
    return { valid: false, error: 'Missing required field: traceId' };
  }
  if (typeof metadata.traceId !== 'string' || metadata.traceId.length > 256) {
    return { valid: false, error: 'traceId must be a string with max length 256' };
  }
  if (metadata.traceType && !['forecast', 'debug', 'error', 'performance'].includes(metadata.traceType)) {
    return { valid: false, error: 'Invalid traceType. Allowed: forecast, debug, error, performance' };
  }
  return { valid: true };
}

/**
 * Handles trace upload to Cloudflare R2 storage.
 * 
 * @param {Request} request - The incoming HTTP request
 * @param {object} env - Cloudflare Worker environment bindings (must include R2 bucket binding)
 * @param {object} ctx - Execution context
 * @returns {Response} - HTTP response
 */
async function handleTraceUpload(request, env, ctx) {
  // Only allow POST and PUT methods
  if (request.method !== 'POST' && request.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST or PUT.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST, PUT' },
    });
  }

  // Authenticate request
  const auth = validateAuth(request, env);
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify R2 bucket binding exists
  const bucket = env.TRACE_BUCKET || env.R2_BUCKET;
  if (!bucket) {
    return new Response(JSON.stringify({ error: 'R2 bucket not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check content length
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_TRACE_SIZE) {
    return new Response(JSON.stringify({
      error: `Trace size exceeds maximum allowed size of ${MAX_TRACE_SIZE} bytes`,
    }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Parse the request body
    const contentType = request.headers.get('Content-Type') || 'application/json';
    let traceData;
    let metadata;

    if (contentType.includes('application/json')) {
      const body = await request.json();
      metadata = body.metadata || {};
      traceData = JSON.stringify(body.trace || body.data || body);
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const metadataField = formData.get('metadata');
      metadata = metadataField ? JSON.parse(metadataField) : {};
      const traceFile = formData.get('trace');
      if (traceFile) {
        traceData = await traceFile.text();
      } else {
        return new Response(JSON.stringify({ error: 'Missing trace data in form' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      traceData = await request.text();
      metadata = {
        traceId: request.headers.get('X-Trace-Id') || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        traceType: request.headers.get('X-Trace-Type') || 'forecast',
      };
    }

    // Ensure we have a traceId
    if (!metadata.traceId) {
      metadata.traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Validate metadata
    const metaValidation = validateTraceMetadata(metadata);
    if (!metaValidation.valid) {
      return new Response(JSON.stringify({ error: metaValidation.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const traceType = metadata.traceType || 'forecast';
    const key = generateTraceKey(metadata.traceId, auth.userId, traceType);

    // Build R2 custom metadata
    const customMetadata = {
      traceId: metadata.traceId,
      userId: auth.userId,
      traceType: traceType,
      uploadedAt: new Date().toISOString(),
      source: metadata.source || 'api',
    };

    if (metadata.forecastId) {
      customMetadata.forecastId = metadata.forecastId;
    }
    if (metadata.tags) {
      customMetadata.tags = Array.isArray(metadata.tags) ? metadata.tags.join(',') : String(metadata.tags);
    }

    // Upload trace to R2
    const r2Object = await bucket.put(key, traceData, {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata,
    });

    return new Response(JSON.stringify({
      success: true,
      key,
      traceId: metadata.traceId,
      size: r2Object.size,
      etag: r2Object.etag,
      uploaded: r2Object.uploaded.toISOString(),
      metadata: customMetadata,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('R2 trace upload error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to upload trace to R2',
      detail: err.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handles batch trace upload to R2 storage.
 * @param {Request} request - The incoming request containing array of traces
 * @param {object} env - Environment bindings
 * @param {object} ctx - Execution context
 * @returns {Response}
 */
async function handleBatchTraceUpload(request, env, ctx) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = validateAuth(request, env);
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bucket = env.TRACE_BUCKET || env.R2_BUCKET;
  if (!bucket) {
    return new Response(JSON.stringify({ error: 'R2 bucket not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const traces = body.traces;

    if (!Array.isArray(traces) || traces.length === 0) {
      return new Response(JSON.stringify({ error: 'Expected non-empty array of traces' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (traces.length > 100) {
      return new Response(JSON.stringify({ error: 'Maximum batch size is 100 traces' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const results = [];
    const errors = [];

    for (const traceEntry of traces) {
      try {
        const traceId = traceEntry.traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const traceType = traceEntry.traceType || 'forecast';
        const key = generateTraceKey(traceId, auth.userId, traceType);

        const customMetadata = {
          traceId,
          userId: auth.userId,
          traceType,
          uploadedAt: new Date().toISOString(),
          batch: 'true',
        };

        const r2Object = await bucket.put(key, JSON.stringify(traceEntry.data || traceEntry), {
          httpMetadata: { contentType: 'application/json' },
          customMetadata,
        });

        results.push({
          traceId,
          key,
          size: r2Object.size,
          success: true,
        });
      } catch (err) {
        errors.push({
          traceId: traceEntry.traceId || 'unknown',
          error: err.message,
          success: false,
        });
      }
    }

    return new Response(JSON.stringify({
      success: errors.length === 0,
      uploaded: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: errors.length === 0 ? 201 : 207,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('R2 batch trace upload error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to process batch trace upload',
      detail: err.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

module.exports = {
  handleTraceUpload,
  handleBatchTraceUpload,
  validateAuth,
  generateTraceKey,
  validateTraceMetadata,
};
