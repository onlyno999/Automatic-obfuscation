import { connect } from 'cloudflare:sockets';

let UUID = "3523c510-9ff0-415b-9582-93949bfae7e3";
const MAX_PENDING = 2 * 1024 * 1024, KEEPALIVE = 15000, STALL_TO = 8000, MAX_STALL = 12, MAX_RECONN = 24;
const buildUUID = (a, i) => Array.from(a.slice(i, i + 16)).map(n => n.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('OK', { status: 200 });

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    
    // Hard-coded proxy IP with default port 443
    const proxyIP = {
      address: 'wok.woxxxxxx.nyc.mn',
      port: 443  // Default to 443 if no port is specified
    };

    handle(server, proxyIP);
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

// parseAddressPort function is still the same
const parseAddressPort = (seg) => {
  if (seg.startsWith("[")) {
    const m = seg.match(/^\[(.+?)\]:(\d+)$/);
    if (m) return [m[1], Number(m[2])];
    return [seg.slice(1, -1), 443];
  }
  const [addr, port = 443] = seg.split(":");
  return [addr, Number(port)];
};

// SOCKS5 connection handling, similar to your original code
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

// Function for HTTP Connect
async function httpConnect(addressType, addressRemote, portRemote, cfg) {
  const { username, password, hostname, port } = cfg;
  const sock = connect({ hostname, port });
  let req = `CONNECT ${addressRemote}:${portRemote} HTTP/1.1\r\n` +
            `Host: ${addressRemote}:${portRemote}\r\n`;
  if (username && password) {
    req += `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n`;
  }
  req += `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36\r\n` +
         `Connection: keep-alive\r\n\r\n`;
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
      if (/^HTTP\/1\.[01] 2/i.test(txt.split("\r\n")[0])) {
        reader.releaseLock();
        return sock;
      }
      throw new Error(`HTTP proxy refused: ${txt.split("\r\n")[0]}`);
    }
  }
}

// Function to handle proxy connection
const handle = (ws, proxyIP) => {
  const pool = new Pool();
  let sock, w, r, info, first = true;
  const updateMode = s => { /* keep your original mode update logic */ };
  
  const tryConnect = async (host, port, addressType) => {
    try {
      const socket = connect({ hostname: host, port });
      if (socket.opened) await socket.opened;
      return socket;
    } catch (err) {
      throw err;
    }
  };

  const establish = async () => {
    try {
      sock = await tryConnect(info.host, info.port, info.addressType);
      if (sock.opened) await sock.opened;
      w = sock.writable.getWriter();
      r = sock.readable.getReader();
      readLoop();
    } catch (e) {
      cleanup(); ws.close(1011, 'Max reconnect.');
    }
  };

  const readLoop = async () => {
    if (reading) return;
    reading = true;
    try {
      while (true) {
        const { done, value: v } = await r.read();
        if (done) {
          reading = false;
          reconn();
          break;
        }
        if (ws.readyState === 1) ws.send(v);
      }
    } catch (e) {
      cleanup();
      ws.close(1006, 'Error.');
    }
  };

  const reconn = async () => {
    if (sock && sock.readyState !== 1) {
      await establish();
    } else {
      cleanup();
      ws.close(1011, 'Exhausted.');
    }
  };

  const cleanup = () => {
    pool.reset();
    if (ws.readyState === 1) ws.close(1006, 'Error.');
  };

  ws.addEventListener('message', async e => {
    if (first) {
      first = false;
      const b = new Uint8Array(e.data);
      const { host, port, addressType } = extractAddr(b);
      info = { host, port, addressType };
      ws.send(new Uint8Array([b[0], 0]));
      establish();
    } else {
      const buf = pool.alloc(e.data.byteLength);
      buf.set(new Uint8Array(e.data));
      pool.free(buf);
    }
  });

  ws.addEventListener('close', cleanup);
  ws.addEventListener('error', cleanup);
};
