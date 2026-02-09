
import { connect } from 'cloudflare:sockets';

let UUID = "bee9ac63-20ea-4b0b-876a-09831e5f755a";
const MAX_PENDING = 2 * 1024 * 1024, KEEPALIVE = 15000, STALL_TO = 8000, MAX_STALL = 12, MAX_RECONN = 24;
const buildUUID = (a, i) => Array.from(a.slice(i, i + 16)).map(n => n.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('OK', { status: 200 });
//    if (env.UUID) UUID = env.UUID.trim();   //UUID 环境变量支持，snippet不能有
    const { proxyIP, socks5, enableSocks, globalProxy } = parseProxyConfig(url.pathname);
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    handle(server, proxyIP, socks5, enableSocks, globalProxy);
    return new Response(null, { status: 101, webSocket: client });
  }
};

const extractAddr = b => {
  const o1 = 18 + b[17] + 1, p = (b[o1] << 8) | b[o1 + 1], t = b[o1 + 2]; let o2 = o1 + 3, h, l;
  switch (t) {
    case 1: l = 4; h = b.slice(o2, o2 + l).join('.'); break;
    case 2: l = b[o2++]; h = new TextDecoder().decode(b.slice(o2, o2 + l)); break;
    case 3: l = 16; h = `[${Array.from({ length: 8 }, (_, i) => ((b[o2 + i * 2] << 8) | b[o2 + i * 2 + 1]).toString(16)).join(':')}]`; break;
    default: throw new Error('Invalid address type.');
  } return { host: h, port: p, payload: b.slice(o2 + l), addressType: t };
};

/* ---------- 地址/端口解析（修复 IPv6 正则） ---------- */
const parseAddressPort = (seg) => {
  if (seg.startsWith("[")) {
    const m = seg.match(/^\[(.+?)\]:(\d+)$/);
    if (m) return [m[1], Number(m[2])];
    return [seg.slice(1, -1), 443];
  }
  const [addr, port = 443] = seg.split(":");
  return [addr, Number(port)];
};

const socks5AddressParser = (raw) => {
  let username, password, hostname, port;

  // 支持完整 URL 形式（全局代理）
    if (raw.includes('://') && !raw.match(/^(socks5?|https?):\/\//i)) {
    const u = new URL(raw);
    hostname = u.hostname;
    port = u.port || (u.protocol === 'http:' ? 80 : 1080);
    const auth = u.username || u.password ? `${u.username}:${u.password}` : u.username;
    if (auth && auth.includes(':')) [username, password] = auth.split(':');
    else if (auth) {
      try { const dec = atob(auth.replace(/%3D/g, '=').padEnd(auth.length + (4 - auth.length % 4) % 4, '=')); 
            const p = dec.split(':'); if (p.length === 2) [username, password] = p; } catch {}
    }
  } else {
    // 局部代理形式：user:pass@host:port 或 base64@host:port
    let authPart = '', hostPart = raw;
    const at = raw.lastIndexOf('@');
    if (at !== -1) { authPart = raw.substring(0, at); hostPart = raw.substring(at + 1); }

    if (authPart && !authPart.includes(':')) {
      try { const dec = atob(authPart.replace(/%3D/g, '=').padEnd(authPart.length + (4 - authPart.length % 4) % 4, '=')); 
            const p = dec.split(':'); if (p.length === 2) [username, password] = p; } catch {}
    }
    if (!username && authPart && authPart.includes(':')) [username, password] = authPart.split(':');

    const [h, p] = parseAddressPort(hostPart);
    hostname = h; port = p || (raw.includes('http=') ? 80 : 1080);
  }

  if (!hostname || isNaN(port)) throw new Error("Invalid proxy config");
  return { username, password, hostname, port };
};

async function socks5Connect(addressType, addressRemote, portRemote, cfg) {
  const { username, password, hostname, port } = cfg;
  const socket = connect({ hostname, port });
  const writer = socket.writable.getWriter();
  await writer.write(new Uint8Array([5, username ? 2 : 1, 0, username ? 2 : 0]));
  const reader = socket.readable.getReader();
  const enc = new TextEncoder();
  let resp = (await reader.read()).value;
  if (resp[1] === 2) {
    const auth = new Uint8Array([1, username.length, ...enc.encode(username), password.length, ...enc.encode(password)]);
    await writer.write(auth);
    resp = (await reader.read()).value;
    if (resp[1] !== 0) throw new Error("SOCKS5 auth failed");
  }
  let DST;
  if (addressType === 1) DST = new Uint8Array([1, ...addressRemote.split(".").map(Number)]);
  else if (addressType === 2) DST = new Uint8Array([3, addressRemote.length, ...enc.encode(addressRemote)]);
  else if (addressType === 3) {
    const bytes = addressRemote.slice(1, -1).split(':').flatMap(h => [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16)]);
    DST = new Uint8Array([4, ...bytes]);
  }
  await writer.write(new Uint8Array([5, 1, 0, ...DST, (portRemote >> 8) & 0xff, portRemote & 0xff]));
  resp = (await reader.read()).value;
  if (resp[1] !== 0) throw new Error("SOCKS5 connect failed");
  writer.releaseLock(); reader.releaseLock();
  return socket;
}

//httpConnect

async function httpConnect(addressType, addressRemote, portRemote, cfg) {
  const { username, password, hostname, port } = cfg;
  const sock = connect({ hostname, port });   // 注意：这里不用 await，后面会自动等

  let req = `CONNECT ${addressRemote}:${portRemote} HTTP/1.1\r\n` +
            `Host: ${addressRemote}:${portRemote}\r\n`;

  if (username && password) {
    req += `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n`;
  }

  // 关键修改：删掉 Proxy-Connection，用完整的现代 UA
  req += `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36\r\n` +
         `Connection: keep-alive\r\n\r\n`;   // 只留这一个！

  const writer = sock.writable.getWriter();
  await writer.write(new TextEncoder().encode(req));
  writer.releaseLock();

  const reader = sock.readable.getReader();
  let buf = new Uint8Array(0);

  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("HTTP proxy closed unexpectedly");

    const tmp = new Uint8Array(buf.length + value.length);
    tmp.set(buf);
    tmp.set(value, buf.length);
    buf = tmp;
    if (buf.length > 65536) throw new Error("HTTP proxy response too large"); 
    const txt = new TextDecoder().decode(buf);
    if (txt.includes("\r\n\r\n")) {
      // 关键修改：兼容 200/201/202 + 大小写
      if (/^HTTP\/1\.[01] 2/i.test(txt.split("\r\n")[0])) {
        reader.releaseLock();
        return sock;
      }
      throw new Error(`HTTP proxy refused: ${txt.split("\r\n")[0]}`);
    }
  }
}

// parseProxyConfig 
function parseProxyConfig(path) {
  let proxyIP = null, socks5 = null, enableSocks = null, globalProxy = null;

  // ===== 1. 全局代理（最宽松最稳，支持任意位置、带?参数、大小写）=====
    const globalMatch = path.match(/(socks5?|https?):\/\/([^/#?]+)/i);
    if (globalMatch) {
      const cfg = socks5AddressParser(globalMatch[2]);   // 正确！只传 user:pass@host:port
      globalProxy = { 
        type: globalMatch[1].toLowerCase().includes('5') || globalMatch[1] === 'socks' ? 'socks5' : 'http',
        cfg 
      };
      return { proxyIP, socks5, enableSocks, globalProxy };
    }

  // ===== 2. 局部 proxyip =====
const ipMatch = path.match(/(?:^|\/)(?:proxy)?ip[=\/]([^?#]+)/i);
if (ipMatch) {
  const seg = ipMatch[1];
  const [addr, port = 443] = parseAddressPort(seg);
  proxyIP = { 
    address: addr.includes('[') ? addr.slice(1, -1) : addr, 
    port: +port 
  };
}

  // ===== 3. 局部 s5 / http（支持大小写）=====
  const localMatch = path.match(/(?:^|\/)(socks5?|s5|http)[=\/]([^/#?]+)/i);
  if (localMatch) {
    const seg = localMatch[2];
    socks5 = socks5AddressParser(seg);
    enableSocks = localMatch[1].toLowerCase().includes('http') ? 'http' : 'socks5';
  }

  return { proxyIP, socks5, enableSocks, globalProxy };
}

class Pool {
  constructor() { this.buf = new ArrayBuffer(16384); this.ptr = 0; this.pool = []; this.max = 8; this.large = false; }
  alloc = s => {
    if (s <= 4096 && s <= 16384 - this.ptr) { const v = new Uint8Array(this.buf, this.ptr, s); this.ptr += s; return v; } const r = this.pool.pop();
    if (r && r.byteLength >= s) return new Uint8Array(r.buffer, 0, s); return new Uint8Array(s);
  };
  free = b => {
    if (b.buffer === this.buf) { this.ptr = Math.max(0, this.ptr - b.length); return; }
    if (this.pool.length < this.max && b.byteLength >= 1024) this.pool.push(b);
  }; enableLarge = () => { this.large = true; }; reset = () => { this.ptr = 0; this.pool.length = 0; this.large = false; };
}


const handle = (ws, proxyIP, socks5, enableSocks, globalProxy) => {
  const pool = new Pool(); let sock, w, r, info, first = true, rxBytes = 0, stalls = 0, reconns = 0;
  let lastAct = Date.now(), conn = false, reading = false; const tmrs = {}, pend = [];
  let pendBytes = 0, score = 1.0, lastChk = Date.now(), lastRx = 0, succ = 0, fail = 0;
  let stats = { tot: 0, cnt: 0, big: 0, win: 0, ts: Date.now() }; let mode = 'adaptive', avgSz = 0, tputs = [];
  const updateMode = s => {
    stats.tot += s; stats.cnt++; if (s > 8192) stats.big++; avgSz = avgSz * 0.9 + s * 0.1; const now = Date.now();
    if (now - stats.ts > 1000) {
      const rate = stats.win; tputs.push(rate); if (tputs.length > 5) tputs.shift(); stats.win = s; stats.ts = now;
      const avg = tputs.reduce((a, b) => a + b, 0) / tputs.length;
      if (stats.cnt >= 20) {
        if (avg < 8388608 || avgSz < 4096) { if (mode !== 'buffered') { mode = 'buffered'; pool.enableLarge(); } }
        else if (avg > 16777216 && avgSz > 12288) { if (mode !== 'direct') mode = 'direct'; }
        else { if (mode !== 'adaptive') mode = 'adaptive'; }
      }} else { stats.win += s; }
  };

  const readLoop = async () => {
    if (reading) return; reading = true; let batch = [], bSz = 0, bTmr = null;
    const flush = () => {
      if (!bSz) return; const m = new Uint8Array(bSz); let p = 0;
      for (const c of batch) { m.set(c, p); p += c.length; }
      if (ws.readyState === 1) ws.send(m);
      batch = []; bSz = 0; if (bTmr) { clearTimeout(bTmr); bTmr = null; }
    };
    try {
      while (true) {
        if (pendBytes > MAX_PENDING) { await new Promise(res => setTimeout(res, 100)); continue; }
        const { done, value: v } = await r.read();
        if (v?.length) {
          rxBytes += v.length; lastAct = Date.now(); stalls = 0; updateMode(v.length); const now = Date.now();
          if (now - lastChk > 5000) {
            const el = now - lastChk, by = rxBytes - lastRx, tp = by / el;
            if (tp > 500) score = Math.min(1.0, score + 0.05);
            else if (tp < 50) score = Math.max(0.1, score - 0.05);
            lastChk = now; lastRx = rxBytes;
          }
          if (mode === 'buffered') {
            if (v.length < 16384) {
              batch.push(v); bSz += v.length;
              if (bSz >= 65536) flush();
              else if (!bTmr) bTmr = setTimeout(flush, avgSz > 8192 ? 8 : 25);
            } else { flush(); if (ws.readyState === 1) ws.send(v); }
          } else if (mode === 'direct') { flush(); if (ws.readyState === 1) ws.send(v);
          } else if (mode === 'adaptive') {
            if (v.length < 8192) {
              batch.push(v); bSz += v.length;
              if (bSz >= 49152) flush();
              else if (!bTmr) bTmr = setTimeout(flush, 12);
            } else { flush(); if (ws.readyState === 1) ws.send(v); } }
        } if (done) { flush(); reading = false; reconn(); break; }
      }} catch (e) { flush(); if (bTmr) clearTimeout(bTmr); reading = false; fail++; reconn(); }
  };

    // 把 tryConnect 改成接收参数！！！千万别用闭包读取 info！
    const tryConnect = async (host, port, addressType) => {
      // 1. 全局代理优先（不 fallback）
      if (globalProxy) {
          if (globalProxy.type === 'socks5')
            return await socks5Connect(addressType, host, port, globalProxy.cfg);
          if (globalProxy.type === 'http')
            return await httpConnect(addressType, host, port, globalProxy.cfg);
        } 

      // 2. 直连
      try {
        const socket = connect({ hostname: host, port });
        if (socket.opened) await socket.opened;
        return socket;
      } catch (err) {
        // 3. 只要配置了代理，就尝试 fallback
        if (!socks5 && !proxyIP) throw err;
        // 局部代理（s5/http）
        if (socks5) {
          try {
            const localSocket = enableSocks === 'http'
              ? await httpConnect(addressType, host, port, socks5)
              : await socks5Connect(addressType, host, port, socks5);
            if (localSocket.opened) await localSocket.opened;
            return localSocket;
          } catch {}
        }

        // proxyip 
        if (proxyIP) {
          try {
            const proxySocket = connect({ hostname: proxyIP.address, port: proxyIP.port });
            if (proxySocket.opened) await proxySocket.opened;
            return proxySocket;
          } catch {}
        }

        throw err; 
      }
    };

// ==================== establish 调用 ====================

  const establish = async () => {
    try {
      sock = await tryConnect(info.host, info.port, info.addressType);
      if (sock.opened) await sock.opened;
      w = sock.writable.getWriter();
      r = sock.readable.getReader();

      const bt = pend.splice(0, 10);
      for (const b of bt) { await w.write(b); pendBytes -= b.length; pool.free(b); }
      conn = false; reconns = 0; score = Math.min(1.0, score + 0.15); succ++; lastAct = Date.now(); readLoop();
    } catch (e) { conn = false; fail++; score = Math.max(0.1, score - 0.2); reconn(); }
  };

  const reconn = async () => {
    if (!info || ws.readyState !== 1) { cleanup(); ws.close(1011, 'Invalid.'); return; }
    if (reconns >= MAX_RECONN) { cleanup(); ws.close(1011, 'Max reconnect.'); return; }
    if (score < 0.3 && reconns > 5 && Math.random() > 0.6) { cleanup(); ws.close(1011, 'Poor network.'); return; }
    if (conn) return; reconns++; let d = Math.min(50 * Math.pow(1.5, reconns - 1), 3000);
    d *= (1.5 - score * 0.5); d += (Math.random() - 0.5) * d * 0.2; d = Math.max(50, Math.floor(d));
    try {
      cleanSock();
      if (pendBytes > MAX_PENDING * 2) {
        while (pendBytes > MAX_PENDING && pend.length > 5) { const drop = pend.shift(); pendBytes -= drop.length; pool.free(drop); }
      }
      await new Promise(res => setTimeout(res, d)); conn = true;
      sock = connect({ hostname: info.host, port: info.port }); await sock.opened;
      w = sock.writable.getWriter(); r = sock.readable.getReader(); const bt = pend.splice(0, 10);
      for (const b of bt) { await w.write(b); pendBytes -= b.length; pool.free(b); }
      conn = false; reconns = 0; score = Math.min(1.0, score + 0.15); succ++; stalls = 0; lastAct = Date.now(); readLoop();
    } catch (e) { conn = false; fail++; score = Math.max(0.1, score - 0.2);
      if (reconns < MAX_RECONN && ws.readyState === 1) setTimeout(reconn, 500);
      else { cleanup(); ws.close(1011, 'Exhausted.'); }}
  };
  const startTmrs = () => {
    tmrs.ka = setInterval(async () => {
      if (!conn && w && Date.now() - lastAct > KEEPALIVE) { try { await w.write(new Uint8Array(0)); lastAct = Date.now(); } catch (e) { reconn(); }}
    }, KEEPALIVE / 3);
    tmrs.hc = setInterval(() => {
      if (!conn && stats.tot > 0 && Date.now() - lastAct > STALL_TO) { stalls++;
        if (stalls >= MAX_STALL) {
          if (reconns < MAX_RECONN) { stalls = 0; reconn(); }
          else { cleanup(); ws.close(1011, 'Stall.'); }
        }}}, STALL_TO / 2);
  };
  const cleanSock = () => { reading = false; try { w?.releaseLock(); r?.releaseLock(); sock?.close(); } catch {} };
  const cleanup = () => {
    Object.values(tmrs).forEach(clearInterval); cleanSock();
    while (pend.length) pool.free(pend.shift());
    pendBytes = 0; stats = { tot: 0, cnt: 0, big: 0, win: 0, ts: Date.now() };
    mode = 'adaptive'; avgSz = 0; tputs = []; pool.reset();
    if (ws.readyState === 1) ws.close(code, reason);
  };

  ws.addEventListener('message', async e => {
    try {
      if (first) {
        first = false;
        const b = new Uint8Array(e.data);
        if (buildUUID(b, 1) !== UUID) throw new Error('Auth failed');
        const { host, port, payload, addressType } = extractAddr(b);
        info = { host, port, addressType };
        ws.send(new Uint8Array([b[0], 0]));
        conn = true;
        if (payload.length) {
          const buf = pool.alloc(payload.length); buf.set(payload);
          pend.push(buf); pendBytes += buf.length;
        }
        startTmrs();
        establish();
      } else { lastAct = Date.now();
        if (conn || !w) { const buf = pool.alloc(e.data.byteLength); buf.set(new Uint8Array(e.data)); pend.push(buf); pendBytes += buf.length; }
        else { await w.write(e.data); }
      }} catch (err) { cleanup(); ws.close(1006, 'Error.'); }
  });
  ws.addEventListener('close', cleanup);
  ws.addEventListener('error', cleanup);
};
