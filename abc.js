https://open.onezun.dpdns.org/gemini/v1beta/openai/**
 * =================================================================================
 * 修复版：All-in-One AI Gateway Worker (防 1101 崩溃版)
 * =================================================================================
 */

const ROUTE_MAP = {
  "cerebras": "api.cerebras.ai",
  "claude": "api.anthropic.com",
  "gemini": "generativelanguage.googleapis.com",
  "groq": "api.groq.com",
  "openai": "api.openai.com",
};

function extractApiKey(request, service) {
  switch (service) {
    case 'gemini':
      const apiKeyFromHeader = request.headers.get('x-goog-api-key');
      if (apiKeyFromHeader) return apiKeyFromHeader;
      try {
        const url = new URL(request.url);
        const apiKeyFromUrl = url.searchParams.get('key');
        if (apiKeyFromUrl) return apiKeyFromUrl;
      } catch (e) {}
      return null;
    case 'claude':
      return request.headers.get('x-api-key') || null;
    default:
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
      return null;
  }
}

async function getNextKeyIndex(db, service, keysCount) {
  if (!db) throw new Error('D1数据库未配置');
  try {
    const ROTATION_STATE_TABLE = 'rotation_state';
    const statement = db.prepare(`
      INSERT INTO ${ROTATION_STATE_TABLE} (service_name, next_index, last_updated)
      VALUES (?1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(service_name) DO UPDATE
      SET next_index = (next_index + 1) % ?2, last_updated = CURRENT_TIMESTAMP
      RETURNING next_index;
    `).bind(service, keysCount);
    const { results } = await statement.all();
    const nextIndex = results[0]?.next_index || 1;
    return (nextIndex - 1 + keysCount) % keysCount;
  } catch (e) {
    throw new Error(`D1数据库错误: ${e.message}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    // 【修复1】兜底上下文，防止环境未定义导致 1101
    env = env || {};
    ctx = ctx || { waitUntil: () => {} };
    const startTime = Date.now();
    let requestData = {};

    try {
      const url = new URL(request.url);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      
      if (pathSegments.length < 1 || !ROUTE_MAP[pathSegments[0]]) {
        return new Response('URL格式错误：请在路径前加上服务商名称（如 /openai/v1/...）', { status: 325 });
      }

      const service = pathSegments[0];
      requestData = { service, model: 'unknown' };
      
      try {
        if (env.LOGS && request.method === 'POST') {
          if (service === 'gemini') {
            if (pathSegments.length >= 4 && pathSegments[2] === 'models') {
              requestData.model = pathSegments[3].split(':')[0] || 'unknown';
            }
          } else {
            const clonedRequest = request.clone();
            const body = await clonedRequest.json().catch(() => ({}));
            requestData.model = body.model || 'unknown';
          }
        }
      } catch (e) {}

      let response = await handleRequestWithRotation(request, service, env, url);
      
      if (env.LOGS) {
        const clonedResponse = response.clone();
        ctx.waitUntil(logRequest(env, requestData, clonedResponse, startTime));
      }
      return response;

    } catch (err) {
      // 【修复2】全局异常捕获：如果再有致命报错，不再报 1101，而是把真实报错打在网页上，方便排错
      const errorMessage = `Worker 内部致命错误: ${err.message}\n${err.stack}`;
      let response = new Response(errorMessage, { status: 500 });
      
      if (env.LOGS) {
        ctx.waitUntil(logRequest(env, requestData, response, startTime, err));
      }
      return response;
    }
  }
};

async function handleRequestWithRotation(request, service, env, url) {
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  const targetHost = ROUTE_MAP[service];
  url.hostname = targetHost;
  url.pathname = url.pathname.substring(service.length + 1);

  // 【修复3】安全获取 MASTER_KEY
  const masterKey = env?.MASTER_KEY;
  
  // 【修复4】必须剔除原有的 Host 头，否则代理目标服务器会因为 Host 不匹配拒绝连接
  const headers = new Headers(request.headers);
  headers.delete('Host');

  // 【修复5】构造安全的请求配置参数
  const requestInit = {
    method: request.method,
    headers: headers,
    redirect: 'follow',
  };

  // 关键修复：GET / HEAD 请求严格不能包含 body 字段，否则一定会触发 1101 异常
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    requestInit.body = request.body;
  }
  
  if (masterKey) {
    const requestApiKey = extractApiKey(request, service);
    
    if (requestApiKey === masterKey) {
      const serviceKeysEnv = env[`${service.toUpperCase()}_KEYS`];
      
      if (!serviceKeysEnv) {
        return new Response('未配置轮询api key', { status: 326 });
      }
      
      try {
        const serviceKeys = JSON.parse(serviceKeysEnv);
        if (!Array.isArray(serviceKeys) || serviceKeys.length === 0) {
          return new Response('轮询api key格式错误', { status: 326 });
        }
        
        const rotationLimit = env.ROTATION_LIMIT ? parseInt(env.ROTATION_LIMIT) : 5;
        const maxRetries = Math.min(rotationLimit, serviceKeys.length);
        let currentIndex = await getNextKeyIndex(env.DB, service, serviceKeys.length);
        let lastResponse = null;
        
        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
          const selectedKey = serviceKeys[currentIndex];
          const loopHeaders = new Headers(headers);
          const modifiedUrl = new URL(url.toString());
          
          switch (service) {
            case 'gemini':
              loopHeaders.set('x-goog-api-key', selectedKey);
              if (modifiedUrl.searchParams.has('key')) modifiedUrl.searchParams.delete('key');
              break;
            case 'claude':
              loopHeaders.set('x-api-key', selectedKey);
              break;
            default:
              loopHeaders.set('Authorization', `Bearer ${selectedKey}`);
              break;
          }
          
          const proxyRequest = new Request(modifiedUrl.toString(), { ...requestInit, headers: loopHeaders });
          
          try {
            lastResponse = await fetch(proxyRequest);
            if (lastResponse.status !== 429) {
              const newResponse = new Response(lastResponse.body, lastResponse);
              applyCorsHeaders(newResponse);
              return newResponse;
            }
          } catch (fetchError) {}
          
          currentIndex = (currentIndex + 1) % serviceKeys.length;
        }
        
        if (lastResponse && lastResponse.status === 429) {
          const newResponse = new Response(lastResponse.body, lastResponse);
          applyCorsHeaders(newResponse);
          return newResponse;
        }
        
        return new Response('所有API密钥均已超出配额，请稍后再试', { status: 429 });
      } catch (e) {
        return new Response(`轮询配置错误: ${e.message}`, { status: 500 });
      }
    }
  }
  
  // 非轮询模式
  const proxyRequest = new Request(url.toString(), requestInit);
  const upstreamResponse = await fetch(proxyRequest);
  const newResponse = new Response(upstreamResponse.body, upstreamResponse);
  applyCorsHeaders(newResponse);
  return newResponse;
}

async function logRequest(env, requestData, response, startTime, error = null) {
  if (!env?.LOGS) return;
  const latencyMs = Date.now() - startTime;
  const service = requestData.service || "unknown";
  const model = requestData.model || "unknown";

  try {
    const dataPoint = {
      indexes: [service],
      blobs: error ? [service, model, error.message] : [service, model, null],
      doubles: [response.status, latencyMs],
    };
    env.LOGS.writeDataPoint(dataPoint);
  } catch (logError) {}
}

function applyCorsHeaders(response) {
  if (!response.headers.has('Access-Control-Allow-Origin')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, openai-organization');
  }
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, openai-organization'
    }
  });
}
