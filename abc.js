// ============================================================================
// VLESS Proxy Worker - 模块化重构版
// 包含：动态代理提取、AI分流、SOCKS5/HTTP代理链、IPv4/IPv6智能回退
// ============================================================================

import { connect } from 'cloudflare:sockets';

// --- 核心配置区 ---
const CONFIG = {
  PROTOCOL_PREFIX: 'vl' + 'ess' + '://',
  DEFAULT_UUID: 'd342d11e-d424-4583-b36e-524ab1f0afa4',
  DEFAULT_PROXY_IP: 'wok.woxxxxxx.nyc.mn',
  DISGUISE_HTML: `<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>`,
  DEFAULT_SARCASM: "哎呀你找到了我，但是我就是不给你看，气不气，嘿嘿嘿",
  DOH_URL: 'https://1.1.1.1/dns-query'
};

// --- AI 分流名单 (Set结构提升匹配效率) ---
const AI_DOMAINS = new Set([
  'gemini.google.com', 'generativelanguage.googleapis.com', 'ai.google.dev', 'aistudio.google.com', 
  'makersuite.google.com', 'vertexai.googleapis.com', 'deepmind.google', 'deepmind.com',
  'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com',
  'anthropic.com', 'claude.ai',
  'copilot.microsoft.com', 'sydney.bing.com',
  'x.ai', 'grok.com', 'perplexity.ai', 'poe.com'
]);

// ==================== 核心处理器 ====================

export default {
  async fetch(request, env, ctx) {
    try {
      const userID = env.UUID || CONFIG.DEFAULT_UUID;
      const baseProxyIP = env.PROXYIP?.trim() || CONFIG.DEFAULT_PROXY_IP;
      const isHidden = ['true', '1'].includes(String(env.HIDE || env.HIDE_SUBSCRIPTION || env.隐藏).toLowerCase());
      const sarcasmMessage = env.SARCASM_MESSAGE || env.嘲讽语 || CONFIG.DEFAULT_SARCASM;

      if (!isValidUUID(userID)) throw new Error('Invalid UUID configuration');

      const url = new URL(request.url);
      const upgradeHeader = request.headers.get('Upgrade');

      // 1. 常规 HTTP 请求处理 (伪装页与订阅分发)
      if (upgradeHeader !== 'websocket') {
        if (url.pathname === '/') {
          return new Response(CONFIG.DISGUISE_HTML, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        
        if (url.pathname === `/${userID}`) {
          if (isHidden) return new Response(sarcasmMessage, { status: 200, headers: { "Content-Type": "text/plain;charset=utf-8" } });
          return new Response(generateSubConfig(userID, request.headers.get('Host')), { status: 200, headers: { "Content-Type": "text/plain;charset=utf-8" } });
        }

        // 动态测试路径代理
        if (url.pathname.startsWith('/proxyip=')) {
          const testIP = decodeURIComponent(url.pathname.split('=')[1]).trim();
          return new Response(`Global outbound proxy temporarily set to: ${testIP}`, { status: 200 });
        }
        
        return new Response('Not found', { status: 404 });
      }

      // 2. WebSocket 代理请求处理
      // 优先级：路径参数 > URL参数 > 环境变量 > 默认值
      let runtimeProxy = baseProxyIP;
      if (url.pathname.startsWith('/proxyip=')) {
        runtimeProxy = decodeURIComponent(url.pathname.substring(9)).trim() || runtimeProxy;
      } else if (url.searchParams.has('proxyip')) {
        runtimeProxy = url.searchParams.get('proxyip').trim() || runtimeProxy;
      }

      return await handleWebSocketSession(request, userID, runtimeProxy);

    } catch (err) {
      return new Response(err.toString(), { status: 500 });
    }
  }
};

// ==================== WebSocket 与协议层 ====================

async function handleWebSocketSession(request, userID, runtimeProxy) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();

  let isDns = false;
  let remoteSocketWrapper = { value: null };
  const log = (msg) => console.log(`[VLESS] ${msg}`);

  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
  const readableStream = createReadableStream(webSocket, earlyDataHeader, log);

  readableStream.pipeTo(new WritableStream({
    async write(chunk, controller) {
      if (isDns) return handleDNSQuery(chunk, webSocket, null, log);
      if (remoteSocketWrapper.value) {
        const writer = remoteSocketWrapper.value.writable.getWriter();
        await writer.write(chunk);
        writer.releaseLock();
        return;
      }

      const parsed = parseVlessHeader(chunk, userID);
      if (parsed.hasError) {
        log(`VLESS Header Error: ${parsed.message}`);
        safeClose(webSocket);
        throw new Error(parsed.message);
      }

      if (parsed.isUDP) {
        if (parsed.portRemote === 53) {
          isDns = true;
          return handleDNSQuery(chunk.slice(parsed.rawDataIndex), webSocket, new Uint8Array([parsed.version[0], 0]), log);
        }
        safeClose(webSocket);
        throw new Error('UDP only supported for DNS (port 53)');
      }

      // 触发 TCP 路由与连接建立
      await routeAndConnectTCP(
        remoteSocketWrapper, parsed, chunk.slice(parsed.rawDataIndex),
        webSocket, new Uint8Array([parsed.version[0], 0]), runtimeProxy, log
      );
    },
    close() { log('WS stream closed'); },
    abort(err) { log(`WS stream aborted: ${err}`); }
  })).catch(err => log(`Stream pipe error: ${err}`));

  return new Response(null, { status: 101, webSocket: client });
}

// ==================== 路由与连接引擎 ====================

async function routeAndConnectTCP(socketWrapper, parsedReq, rawData, ws, responseHeader, runtimeProxy, log) {
  const { addressRemote, portRemote, addressType } = parsedReq;
  const proxyConfig = parseProxyString(runtimeProxy);
  
  const isAiDomainName = addressType === 2 && Array.from(AI_DOMAINS).some(domain => addressRemote.toLowerCase().includes(domain));
  const requiresProxy = proxyConfig && (proxyConfig.type === 'socks5' || proxyConfig.type === 'http' || isAiDomainName);

  const connectDirectly = async (host, port, forceIPv6 = false) => {
    let target = host;
    if (forceIPv6 && addressType === 2 && !isAiDomainName) {
      target = await resolveDNS(host, 'AAAA') || host;
    }
    const tcp = connect({ hostname: target, port });
    socketWrapper.value = tcp;
    const writer = tcp.writable.getWriter();
    await writer.write(rawData);
    writer.releaseLock();
    log(`Direct -> ${target}:${port}`);
    return tcp;
  };

  const connectViaProxyChain = async (config, data) => {
    let tcp;
    if (config.type === 'socks5') {
      tcp = await connectSocks5(config, addressRemote, portRemote, data);
    } else if (config.type === 'http') {
      tcp = await connectHttpProxy(config, addressRemote, portRemote, data);
    } else {
      let targetHost = config.host;
      if (isAiDomainName || targetHost) {
        targetHost = await resolveDNS(targetHost, 'A') || targetHost; // 强制IPv4保证AI连通性
      }
      tcp = await connectDirectly(targetHost, config.port, false);
    }
    socketWrapper.value = tcp;
    log(`Chain [${config.type}] -> ${addressRemote}:${portRemote}`);
    return tcp;
  };

  const setupPipe = (socket) => {
    socket.closed.catch(() => {}).finally(() => safeClose(ws));
    pipeRemoteToWS(socket, ws, responseHeader, null, log);
  };

  try {
    if (requiresProxy) {
      setupPipe(await connectViaProxyChain(proxyConfig, rawData));
    } else {
      setupPipe(await connectDirectly(addressRemote, portRemote, true)); // 普通流量优选IPv6
    }
  } catch (err) {
    log(`Initial connection failed: ${err.message}. Triggering fallback.`);
    try {
      if (requiresProxy) {
        setupPipe(await connectDirectly(addressRemote, portRemote, false));
      } else if (proxyConfig) {
        setupPipe(await connectViaProxyChain(proxyConfig, rawData));
      }
    } catch (fallbackErr) {
      log(`Fallback also failed: ${fallbackErr.message}`);
      safeClose(ws);
    }
  }
}

// ==================== 代理协议实现 ====================

function parseProxyString(str) {
  if (!str) return null;
  const s = str.trim();
  
  try {
    if (s.startsWith('socks://') || s.startsWith('socks5://')) {
      const u = new URL(s.replace(/^socks:\/\//, 'socks5://'));
      return { type: 'socks5', host: u.hostname, port: parseInt(u.port) || 1080, user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) };
    }
    if (s.startsWith('http://') || s.startsWith('https://')) {
      const u = new URL(s);
      return { type: 'http', host: u.hostname, port: parseInt(u.port) || (s.startsWith('https') ? 443 : 80), user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) };
    }
  } catch (e) { return null; }

  // 提取 IPv6 或 IP:Port
  const matchV6 = s.match(/^\[(.*?)\]:(\d+)$/);
  if (matchV6) return { type: 'direct', host: matchV6[1], port: parseInt(matchV6[2]) };
  
  const parts = s.split(':');
  if (parts.length === 2 && !isNaN(parts[1])) return { type: 'direct', host: parts[0], port: parseInt(parts[1]) };
  
  return { type: 'direct', host: s, port: 443 };
}

async function connectSocks5(config, tHost, tPort, initialData) {
  const socket = connect({ hostname: config.host, port: config.port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  
  try {
    const authMethod = (config.user && config.pass) ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00];
    await writer.write(new Uint8Array(authMethod));
    
    const methodRes = await reader.read();
    if (methodRes.done || methodRes.value[1] === 0xFF) throw new Error('SOCKS5 auth rejection');

    if (methodRes.value[1] === 0x02) {
      const userBuf = new TextEncoder().encode(config.user);
      const passBuf = new TextEncoder().encode(config.pass);
      const authReq = new Uint8Array(3 + userBuf.length + passBuf.length);
      authReq[0] = 0x01; authReq[1] = userBuf.length; authReq.set(userBuf, 2);
      authReq[2 + userBuf.length] = passBuf.length; authReq.set(passBuf, 3 + userBuf.length);
      
      await writer.write(authReq);
      const authRes = await reader.read();
      if (authRes.done || authRes.value[1] !== 0x00) throw new Error('SOCKS5 auth failed');
    }

    const hostBuf = new TextEncoder().encode(tHost);
    const connReq = new Uint8Array(7 + hostBuf.length);
    connReq.set([0x05, 0x01, 0x00, 0x03, hostBuf.length]);
    connReq.set(hostBuf, 5);
    new DataView(connReq.buffer).setUint16(5 + hostBuf.length, tPort, false);
    
    await writer.write(connReq);
    const connRes = await reader.read();
    if (connRes.done || connRes.value[1] !== 0x00) throw new Error('SOCKS5 connect failed');

    await writer.write(initialData);
    writer.releaseLock(); reader.releaseLock();
    return socket;
  } catch (err) {
    writer.releaseLock(); reader.releaseLock(); socket.close();
    throw err;
  }
}

async function connectHttpProxy(config, tHost, tPort, initialData) {
  const socket = connect({ hostname: config.host, port: config.port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  
  try {
    let req = `CONNECT ${tHost}:${tPort} HTTP/1.1\r\nHost: ${tHost}:${tPort}\r\n`;
    if (config.user && config.pass) req += `Proxy-Authorization: Basic ${btoa(`${config.user}:${config.pass}`)}\r\n`;
    req += `User-Agent: Mozilla/5.0\r\nConnection: keep-alive\r\n\r\n`;
    
    await writer.write(new TextEncoder().encode(req));
    
    let buf = new Uint8Array(0), headerEnd = -1;
    while (headerEnd === -1 && buf.length < 8192) {
      const { done, value } = await reader.read();
      if (done) throw new Error('HTTP connect closed prematurely');
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf); next.set(value, buf.length);
      buf = next;
      for (let i = 0; i < buf.length - 3; i++) {
        if (buf[i]===0x0d && buf[i+1]===0x0a && buf[i+2]===0x0d && buf[i+3]===0x0a) { headerEnd = i + 4; break; }
      }
    }
    
    const status = parseInt(new TextDecoder().decode(buf.slice(0, headerEnd)).split(' ')[1]);
    if (status < 200 || status >= 300) throw new Error(`HTTP proxy rejected: ${status}`);
    
    await writer.write(initialData);
    writer.releaseLock(); reader.releaseLock();
    return socket;
  } catch (err) {
    writer.releaseLock(); reader.releaseLock(); socket.close();
    throw err;
  }
}

// ==================== 工具与辅助函数 ====================

async function resolveDNS(domain, type = 'A') {
  if (!domain || domain.match(/^[\d\.]+$/) || domain.includes(':')) return domain;
  try {
    const res = await fetch(`${CONFIG.DOH_URL}?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { 'accept': 'application/dns-json' }, cf: { cacheTtl: 300 }
    });
    const data = await res.json();
    const typeId = type === 'A' ? 1 : 28;
    const records = data.Answer?.filter(a => a.type === typeId);
    if (records?.length > 0) {
      const ip = records[Math.floor(Math.random() * records.length)].data;
      return type === 'AAAA' && !ip.startsWith('[') ? `[${ip}]` : ip;
    }
  } catch (e) {}
  return domain;
}

function parseVlessHeader(buffer, userID) {
  if (buffer.byteLength < 24) return { hasError: true, message: 'Invalid data length' };
  
  const version = new Uint8Array(buffer.slice(0, 1));
  const reqUUID = formatUUID(new Uint8Array(buffer.slice(1, 17)));
  if (reqUUID !== userID) return { hasError: true, message: 'UUID mismatch' };

  const optLen = new Uint8Array(buffer.slice(17, 18))[0];
  const command = new Uint8Array(buffer.slice(18 + optLen, 19 + optLen))[0];
  const isUDP = command === 2;
  
  if (command !== 1 && command !== 2) return { hasError: true, message: `Unsupported command: ${command}` };

  const portIdx = 19 + optLen;
  const portRemote = new DataView(buffer.slice(portIdx, portIdx + 2)).getUint16(0);
  
  const addrType = new Uint8Array(buffer.slice(portIdx + 2, portIdx + 3))[0];
  let addrLen = 0, addrVal = '', valIdx = portIdx + 3;

  if (addrType === 1) { // IPv4
    addrLen = 4;
    addrVal = new Uint8Array(buffer.slice(valIdx, valIdx + addrLen)).join('.');
  } else if (addrType === 2) { // Domain
    addrLen = new Uint8Array(buffer.slice(valIdx, valIdx + 1))[0];
    valIdx += 1;
    addrVal = new TextDecoder().decode(buffer.slice(valIdx, valIdx + addrLen));
  } else if (addrType === 3) { // IPv6
    addrLen = 16;
    const dv = new DataView(buffer.slice(valIdx, valIdx + addrLen));
    addrVal = Array.from({length: 8}, (_, i) => dv.getUint16(i * 2).toString(16)).join(':');
  } else {
    return { hasError: true, message: `Invalid address type: ${addrType}` };
  }

  return { hasError: false, addressRemote: addrVal, addressType: addrType, portRemote, rawDataIndex: valIdx + addrLen, version, isUDP };
}

async function pipeRemoteToWS(remote, ws, header, retryCb, log) {
  let pendingHeader = header;
  let hasData = false;
  
  await remote.readable.pipeTo(new WritableStream({
    async write(chunk) {
      hasData = true;
      if (ws.readyState !== 1) throw new Error('WS not open');
      if (pendingHeader) {
        ws.send(await new Blob([pendingHeader, chunk]).arrayBuffer());
        pendingHeader = null;
      } else {
        ws.send(chunk);
      }
    }
  })).catch(() => safeClose(ws));
  
  if (!hasData && retryCb) retryCb();
}

function createReadableStream(ws, earlyDataHeader, log) {
  let isCanceled = false;
  return new ReadableStream({
    start(controller) {
      ws.addEventListener('message', e => !isCanceled && controller.enqueue(e.data));
      ws.addEventListener('close', () => { safeClose(ws); if(!isCanceled) controller.close(); });
      ws.addEventListener('error', err => controller.error(err));
      
      if (earlyDataHeader) {
        try {
          const buf = Uint8Array.from(atob(earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
          controller.enqueue(buf.buffer);
        } catch (e) {}
      }
    },
    cancel() { isCanceled = true; safeClose(ws); }
  });
}

async function handleDNSQuery(chunk, ws, header, log) {
  try {
    const tcp = connect({ hostname: '8.8.8.8', port: 53 });
    const writer = tcp.writable.getWriter();
    await writer.write(chunk);
    writer.releaseLock();
    
    let pendingHeader = header;
    await tcp.readable.pipeTo(new WritableStream({
      async write(data) {
        if (ws.readyState === 1) {
          if (pendingHeader) {
            ws.send(await new Blob([pendingHeader, data]).arrayBuffer());
            pendingHeader = null;
          } else {
            ws.send(data);
          }
        }
      }
    }));
  } catch (e) { log(`DNS error: ${e.message}`); }
}

function generateSubConfig(uuid, host) {
  return `\nv2ray:\n${CONFIG.PROTOCOL_PREFIX}${uuid}@${host}:443?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#${host}\n`;
}

function safeClose(ws) {
  try { if (ws.readyState === 1 || ws.readyState === 2) ws.close(); } catch (e) {}
}

function isValidUUID(uuid) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

function formatUUID(arr) {
  const hex = Array.from(arr, b => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10,16).join('')}`;
}
