/**
 * =================================================================================
 * All-in-One AI Gateway Worker with Analytics Engine Logging
 * =================================================================================
 *
 * This version integrates with Cloudflare Analytics Engine to log key metrics
 * for every API request, providing powerful, free observability.
 *
 * It requires an Analytics Engine binding named `LOGS`.
 *
 * =================================================================================
 */

// --- CONFIGURATION ---
// Using const for configuration objects with lowercase keys to avoid toLowerCase calls
const ROUTE_MAP = {
  "cerebras": "api.cerebras.ai",
  "claude": "api.anthropic.com",
  "gemini": "generativelanguage.googleapis.com",
  "groq": "api.groq.com",
  "openai": "api.openai.com",
};

// --- HELPER FUNCTIONS FOR API ROTATION ---

/**
 * Extracts API key from request based on service provider format
 * @param {Request} request - The incoming request
 * @param {string} service - Service provider name
 * @returns {string|null} Extracted API key
 */
function extractApiKey(request, service) {
  // Avoid unnecessary toLowerCase calls since service name is already processed in fetch
  switch (service) {
    case 'gemini':
      // Gemini uses x-goog-api-key header or 'key' query parameter
      const apiKeyFromHeader = request.headers.get('x-goog-api-key');
      if (apiKeyFromHeader) {
        return apiKeyFromHeader;
      }
      
      // Check if URL contains 'key' query parameter
      try {
        const url = new URL(request.url);
        const apiKeyFromUrl = url.searchParams.get('key');
        if (apiKeyFromUrl) {
          return apiKeyFromUrl;
        }
      } catch (e) {
        // Ignore URL parsing errors
      }
      
      return null;
    case 'claude':
      // Claude uses x-api-key header
      return request.headers.get('x-api-key') || null;
    default:
      // Other services use Authorization header with Bearer format
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
      return null;
  }
}

/**
 * Gets next API key index to use from D1 database
 * @param {object} db - D1 database instance
 * @param {string} service - Service provider name
 * @param {number} keysCount - Number of available keys
 * @returns {Promise<number>} Next key index to use
 */
async function getNextKeyIndex(db, service, keysCount) {
  if (!db) {
    throw new Error('D1数据库未配置');
  }
  
  try {
    // Table name constant for easier modification
    const ROTATION_STATE_TABLE = 'rotation_state'; // Users can modify based on actual database table name
    
    // Direct operation using D1 standard API, leveraging SQL ON CONFLICT mechanism to ensure atomicity
    const statement = db.prepare(`
      INSERT INTO ${ROTATION_STATE_TABLE} (service_name, next_index, last_updated)
      VALUES (?1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(service_name) DO UPDATE
      SET 
        next_index = (next_index + 1) % ?2,
        last_updated = CURRENT_TIMESTAMP
      RETURNING next_index;
    `).bind(service, keysCount);
    
    const { results } = await statement.all();
    
    // Ensure index is within valid range
    const nextIndex = results[0]?.next_index || 1;
    return (nextIndex - 1 + keysCount) % keysCount;
  } catch (e) {
    throw new Error(`D1数据库错误: ${e.message}`);
  }
}

// --- WORKER LOGIC (ES Modules format) ---
export default {
  /**
   * The main entry point for the Worker.
   * @param {Request} request The incoming request.
   * @param {object} env Environment variables, including the LOGS binding.
   * @param {object} ctx Execution context, used for ctx.waitUntil().
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    let response;
    let requestData = {};

    try {
      // Validate URL format
      const url = new URL(request.url);
      
      // Parse path segments
      const pathSegments = url.pathname.split('/').filter(Boolean);
      
      // Check if there's a service provider segment and it's configured in ROUTE_MAP
      if (pathSegments.length < 1 || !ROUTE_MAP[pathSegments[0]]) {
        // Invalid URL format, return error code 325 without logging
        return new Response('url格式错误', { status: 325 });
      }

      // Extract service name (already validated to be lowercase)
      const service = pathSegments[0];
      
      // Delay cloning request and parsing data until necessary
      requestData = { service, model: 'unknown' };
      
      // Attempt to extract model information without blocking main logic
      try {
        // Only attempt to extract model info if LOGS is configured and it's a POST request
        if (env.LOGS && request.method === 'POST') {
          if (service === 'gemini') {
            // For Gemini POST requests, extract model from URL path
            // Expected format: https://{custom-url}/gemini/v1beta/models/{model-name}:{function-name}
            if (pathSegments.length >= 4 && pathSegments[2] === 'models') {
              // Split by colon to get model name without function suffix
              requestData.model = pathSegments[3].split(':')[0] || 'unknown';
            }
          } else {
            // For other services' POST requests, extract model from request body
            const clonedRequest = request.clone();
            const body = await clonedRequest.json().catch(() => ({}));
            requestData.model = body.model || 'unknown';
          }
        }
      } catch (e) {
        // Ignore any data extraction errors and continue processing
      }

      // Handle API rotation logic and pass parsed URL to avoid duplicate creation
      response = await handleRequestWithRotation(request, service, env, url);
      
      // Only clone response and log when LOGS binding is available
      if (env.LOGS) {
        const clonedResponse = response.clone();
        ctx.waitUntil(logRequest(env, requestData, clonedResponse, startTime));
      }
      
      return response;

    } catch (err) {
      // For URL format errors, we already handled them separately earlier, here handle other errors
      response = new Response(err.message || 'An unexpected error occurred.', { status: 500 });
      
      // Only log error when LOGS binding is available
      if (env.LOGS) {
        ctx.waitUntil(logRequest(env, requestData, response, startTime, err));
      }

      return response;
    }
  }
};

// --- CORE HANDLER ---
/**
 * Request handler with API key rotation functionality
 * @param {Request} request - The incoming request
 * @param {string} service - Service provider name
 * @param {object} env - Environment variables containing LOGS and DB bindings
 * @param {URL} url - Parsed URL object to avoid duplicate creation
 * @returns {Promise<Response>} Processed response
 */
async function handleRequestWithRotation(request, service, env, url) {
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  // Service provider already validated in fetch function, directly get target host
  const targetHost = ROUTE_MAP[service];

  // Reuse the provided URL object to avoid duplicate creation
  url.hostname = targetHost;
  url.pathname = url.pathname.substring(service.length + 1); // Removes /service prefix

  // Get MASTER_KEY configuration
  const masterKey = env.MASTER_KEY;
  
  // Only extract API key and handle rotation logic when rotation mode is enabled
  if (masterKey) {
    const requestApiKey = extractApiKey(request, service);
    
    if (requestApiKey === masterKey) {
      // Enable rotation mode
      const serviceKeysEnv = env[`${service.toUpperCase()}_KEYS`];
      
      if (!serviceKeysEnv) {
        // Rotation API keys not configured
        return new Response('未配置轮询api key', { status: 326 });
      }
      
      try {
        // Parse service provider's key list
        const serviceKeys = JSON.parse(serviceKeysEnv);
        
        if (!Array.isArray(serviceKeys) || serviceKeys.length === 0) {
          return new Response('未配置轮询api key', { status: 326 });
        }
        
        // Get rotation limit from environment variables or use default
        const rotationLimit = env.ROTATION_LIMIT ? parseInt(env.ROTATION_LIMIT) : 5;
        // Optimized rotation retry logic
        const maxRetries = Math.min(rotationLimit, serviceKeys.length); // Maximum retries is the smaller of rotationLimit or the number of keys
        let currentIndex = await getNextKeyIndex(env.DB, service, serviceKeys.length);
        let lastResponse = null;
        
        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
          const selectedKey = serviceKeys[currentIndex];
          
          // Set appropriate request headers based on service provider format
          const headers = new Headers(request.headers);
          
          // Create a copy of the URL for modification
          const modifiedUrl = new URL(url.toString());
          
          // Avoid unnecessary toLowerCase calls
          switch (service) {
            case 'gemini':
              // In rotation mode, always use header for API key regardless of original request format
              headers.set('x-goog-api-key', selectedKey);
              // Remove key parameter from URL if present to avoid conflicts
              if (modifiedUrl.searchParams.has('key')) {
                modifiedUrl.searchParams.delete('key');
              }
              break;
            case 'claude':
              headers.set('x-api-key', selectedKey);
              break;
            default:
              headers.set('Authorization', `Bearer ${selectedKey}`);
              break;
          }
          
          // Create proxy request with new headers and modified URL
          const proxyRequest = new Request(modifiedUrl.toString(), {
            method: request.method,
            headers: headers,
            body: request.body,
            redirect: 'follow',
          });
          
          try {
            lastResponse = await fetch(proxyRequest);
            
            // Check if successful or not a 429 error
            if (lastResponse.status !== 429) {
              // Request successful or non-429 error, return response
              const newResponse = new Response(lastResponse.body, lastResponse);
              applyCorsHeaders(newResponse);
              return newResponse;
            }
            
            // 429 rate limit error encountered, proceeding to try next available API key
            
          } catch (fetchError) {
            // Request exception, continue with next key
          }
          
          // Move to next key index
          currentIndex = (currentIndex + 1) % serviceKeys.length;
        }
        
        // If all keys have been tried or max retries reached
        if (lastResponse && lastResponse.status === 429) {
          // All keys returned 429, return the last response
          const newResponse = new Response(lastResponse.body, lastResponse);
          applyCorsHeaders(newResponse);
          return newResponse;
        }
        
        // No valid response, return generic error
        return new Response('所有API密钥均已超出配额，请稍后再试', { status: 429 });
        
      } catch (e) {
        return new Response(`轮询配置错误: ${e.message}`, { status: 500 });
      }
    }
  }
  
  // Non-rotation mode, directly create and send request to avoid extra comparison operations
  const proxyRequest = new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'follow',
  });
  
  const upstreamResponse = await fetch(proxyRequest);
  const newResponse = new Response(upstreamResponse.body, upstreamResponse);
  applyCorsHeaders(newResponse);
  return newResponse;
}

/**
 * Asynchronously logs data to the Analytics Engine.
 * @param {object} env - The environment object containing bindings.
 * @param {object} requestData - Data extracted from the request {service, model}.
 * @param {Response} response - The final response object.
 * @param {number} startTime - The timestamp when the request started.
 * @param {Error} [error] - An optional error object if the request failed.
 */
async function logRequest(env, requestData, response, startTime, error = null) {
  // Check for LOGS binding to avoid unnecessary computations
  if (!env.LOGS) {
    return;
  }

  const latencyMs = Date.now() - startTime;
  const service = requestData.service || "unknown";
  const model = requestData.model || "unknown";

  try {
    // Prepare log data point, add error information only when there's an error
    const dataPoint = {
      // Configure data point as required
      indexes: [
        service
      ],
      // Add error information only when there's an error
      blobs: error ? [
        service,
        model,
        error.message
      ] : [
        service,
        model,
        null
      ],
      doubles: [
        response.status,
        latencyMs
      ],
    };

    // Write the data point to the Analytics Engine
    env.LOGS.writeDataPoint(dataPoint);

  } catch (logError) {
    // Ignore logging errors to avoid affecting main process
  }
}


// --- HELPER FUNCTIONS ---
function applyCorsHeaders(response) {
  // Avoid duplicate CORS header settings
  if (!response.headers.has('Access-Control-Allow-Origin')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, openai-organization');
  }
}

function handleOptions() {
  // Directly create response with CORS headers to avoid extra function calls
  const response = new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, openai-organization'
    }
  });
  return response;
}
