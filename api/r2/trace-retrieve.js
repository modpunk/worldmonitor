/**
 * R2 Trace Retrieve Module
 * 
 * Handles retrieving forecast debugging traces from Cloudflare R2 storage.
 * Integrates with existing authentication patterns.
 */

const { validateAuth } = require('./trace-upload');

/**
 * Retrieves a single trace from R2 by its key or traceId.
 * 
 * @param {Request} request - The incoming HTTP request
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {object} ctx - Execution context
 * @returns {Response}
 */
async function handleTraceRetrieve(request, env, ctx) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use GET.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'GET' },
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

  const bucket = env.TRACE_BUCKET || env.R2_BUCKET;
  if (!bucket) {
    return new Response(JSON.stringify({ error: 'R2 bucket not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const traceId = url.searchParams.get('traceId');
  const includeMetadata = url.searchParams.get('metadata') !== 'false';

  if (!key && !traceId) {
    return new Response(JSON.stringify({
      error: 'Missing required parameter: key or traceId',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let r2Object;

    if (key) {
      // Direct key lookup
      r2Object = await bucket.get(key);
    } else if (traceId) {
      // Search by traceId - list objects and find matching one
      r2Object = await findTraceById(bucket, traceId);
    }

    if (!r2Object) {
      return new Response(JSON.stringify({
        error: 'Trace not found',
        traceId: traceId || undefined,
        key: key || undefined,
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await r2Object.text();
    const responseHeaders = {
      'Content-Type': r2Object.httpMetadata?.contentType || 'application/json',
      'ETag': r2Object.etag,
      'Last-Modified': r2Object.uploaded?.toUTCString() || new Date().toUTCString(),
    };

    if (includeMetadata) {
      // Return trace data with metadata wrapper
      const response = {
        trace: tryParseJSON(body),
        metadata: {
          key: r2Object.key,
          size: r2Object.size,
          etag: r2Object.etag,
          uploaded: r2Object.uploaded?.toISOString(),
          customMetadata: r2Object.customMetadata || {},
        },
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      // Return raw trace data
      return new Response(body, {
        status: 200,
        headers: responseHeaders,
      });
    }
  } catch (err) {
    console.error('R2 trace retrieve error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to retrieve trace from R2',
      detail: err.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Lists traces from R2 with optional filtering.
 * 
 * @param {Request} request - The incoming HTTP request
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {object} ctx - Execution context
 * @returns {Response}
 */
async function handleTraceList(request, env, ctx) {
  if (request.method !== 'GET') {
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

  const url = new URL(request.url);
  const traceType = url.searchParams.get('type') || 'forecast';
  const date = url.searchParams.get('date'); // YYYY-MM-DD format
  const userId = url.searchParams.get('userId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000);
  const cursor = url.searchParams.get('cursor') || undefined;
  const includeCustomMetadata = url.searchParams.get('includeMetadata') === 'true';

  // Build prefix for filtering
  let prefix = `traces/${traceType}/`;
  if (date) {
    const dateParts = date.split('-');
    if (dateParts.length === 3) {
      prefix += `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}/`;
    }
  }
  if (userId) {
    prefix += userId ? `${userId}/` : '';
  }

  try {
    const listOptions = {
      prefix,
      limit,
      cursor,
      include: includeCustomMetadata ? ['customMetadata', 'httpMetadata'] : ['httpMetadata'],
    };

    const listed = await bucket.list(listOptions);

    const traces = listed.objects.map((obj) => {
      const result = {
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        uploaded: obj.uploaded?.toISOString(),
      };

      if (includeCustomMetadata && obj.customMetadata) {
        result.customMetadata = obj.customMetadata;
      }

      return result;
    });

    return new Response(JSON.stringify({
      traces,
      count: traces.length,
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : undefined,
      prefix,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('R2 trace list error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to list traces from R2',
      detail: err.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Deletes a trace from R2 storage.
 * 
 * @param {Request} request - The incoming HTTP request
 * @param {object} env - Environment bindings
 * @param {object} ctx - Execution context
 * @returns {Response}
 */
async function handleTraceDelete(request, env, ctx) {
  if (request.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use DELETE.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'DELETE' },
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

  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!key) {
    return new Response(JSON.stringify({ error: 'Missing required parameter: key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Verify the object exists before deleting
    const existing = await bucket.head(key);
    if (!existing) {
      return new Response(JSON.stringify({
        error: 'Trace not found',
        key,
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await bucket.delete(key);

    return new Response(JSON.stringify({
      success: true,
      deleted: key,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('R2 trace delete error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to delete trace from R2',
      detail: err.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Searches for a trace by traceId across the R2 bucket.
 * @param {object} bucket - R2 bucket binding
 * @param {string} traceId - The trace ID to search for
 * @returns {object|null} - The R2 object or null
 */
async function findTraceById(bucket, traceId) {
  // Search across trace types
  const traceTypes = ['forecast', 'debug', 'error', 'performance'];

  for (const traceType of traceTypes) {
    const prefix = `traces/${traceType}/`;
    const listed = await bucket.list({
      prefix,
      limit: 1000,
      include: ['customMetadata'],
    });

    for (const obj of listed.objects) {
      if (obj.customMetadata && obj.customMetadata.traceId === traceId) {
        return await bucket.get(obj.key);
      }
      // Also check if traceId is part of the key
      if (obj.key.endsWith(`/${traceId}`)) {
        return await bucket.get(obj.key);
      }
    }
  }

  return null;
}

/**
 * Attempts to parse a string as JSON, returns the original string on failure.
 * @param {string} str - String to parse
 * @returns {object|string}
 */
function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

module.exports = {
  handleTraceRetrieve,
  handleTraceList,
  handleTraceDelete,
  findTraceById,
};
