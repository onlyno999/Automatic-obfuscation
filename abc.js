export default {
  async fetch(a) {
    const b = new URL(a.url);
    const c = a.headers.get('Upgrade');

    if ('websocket' !== c) {
      // 订阅地址访问控制
      if (set && b.pathname === `/${config.id}/vless`) {
        return new Response(generateVlessConfig(a.headers.get('Host')), {
          status: 200,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
      } else {
        return new Response('Expected WebSocket', { status: 400 });
      }
    }

    // 下面处理 WebSocket 连接

    const d = decodeBase64(a.headers.get('sec-websocket-protocol'));
    if (verifyUUID(new Uint8Array(d.slice(1, 17))) !== config.uuid) {
      return new Response('Invalid UUID', { status: 403 });
    }

    const { tcpSocket: e, initialData: f } = await parseVlessHeader(d);
    return await upgradeWebSocket(a, e, f);
  }
};

async function upgradeWebSocket(a, b, c) {
  const { 0: d, 1: e } = new WebSocketPair();
  e.accept();
  pipeline(e, b, c);
  return new Response(null, { status: 101, webSocket: d });
}

async function parseVlessHeader(a) {
  const b = new DataView(a),
    c = new Uint8Array(a),
    d = c[17],
    e = b.getUint16(18 + d + 1),
    f = c[18 + d + 3];

  let g,
    h = 18 + d + 4;

  if (1 === f) {
    g = Array.from(c.slice(h, h + 4)).join('.');
    h += 4;
  } else if (2 === f) {
    const len = c[h];
    g = new TextDecoder().decode(c.slice(h + 1, h + 1 + len));
    h += len + 1;
  } else {
    const v = new DataView(a);
    g = Array(8)
      .fill()
      .map((_, i) => v.getUint16(h + 2 * i).toString(16))
      .join(':');
    h += 16;
  }

  const i = a.slice(h);

  async function k(hostname, port) {
    try {
      const sock = connect({ hostname, port });
      await sock.opened;
      return sock;
    } catch (err) {
      console.error('Connection error:', err);
      throw err;
    }
  }

  let j;
  try {
    console.log('Connecting to:', g, e);
    j = await k(g, e);
  } catch {
    const [host, portStr] = config.proxyIP.split(':');
    if (!config.enableProxy || !config.proxyIP) throw Error('Connection failed');
    console.log('Trying proxy:', host, portStr || e);
    try {
      j = await k(host, Number(portStr) || e);
    } catch {
      throw Error('Proxy connection failed');
    }
  }

  return { tcpSocket: j, initialData: i };
}

async function pipeline(ws, tcp, initialData) {
  ws.send(new Uint8Array([0, 0]));
  const writer = tcp.writable.getWriter();
  const reader = tcp.readable.getReader();

  if (initialData) await writer.write(initialData);
  ws.addEventListener('message', (evt) => writer.write(evt.data));

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) ws.send(value);
    }
  } catch (err) {
    console.error('Error reading TCP:', err);
  } finally {
    try { ws.close(); } catch {}
    try { await reader.cancel(); } catch {}
    try { writer.releaseLock(); } catch {}
    try { tcp.close(); } catch {}
  }
}

function decodeBase64(str) {
  return Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0)
  ).buffer;
}

function verifyUUID(bytes) {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generateVlessConfig(host) {
  const path = '/?ed=2560';
  return `vless://${config.uuid}@${config.node}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${encodeURIComponent(path)}#${encodeURIComponent(config.nodeName)}`;
}
