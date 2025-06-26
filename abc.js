// Random noise code for obfuscation  
const dummyNoise = (() => {  
  const rand = Math.random();  
  return rand > 0.5 ? 'no-op' : 'noise';  
})();  

export default {  
  async fetch(request) {  
    const url = new URL(request.url);  
    const upgradeHeader = request.headers.get('Upgrade');  

    if (upgradeHeader !== 'websocket') {  
      // Subscription path access control  
      if (set && url.pathname === `/${config.id}/vless`) {  
        return new Response(generateVlessConfig(request.headers.get('Host')), {  
          status: 200,  
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }  
        });  
      } else {  
        return new Response('Expected WebSocket', { status: 400 });  
      }  
    }  

    // Handle WebSocket connection  

    const decoded = decodeBase64(request.headers.get('sec-websocket-protocol'));  
    if (verifyUUID(new Uint8Array(decoded.slice(1, 17))) !== config.uuid) {  
      return new Response('Invalid UUID', { status: 403 });  
    }  

    const { tcpSocket, initialData } = await parseVlessHeader(decoded);  
    return await upgradeWebSocket(request, tcpSocket, initialData);  
  }  
};  

async function upgradeWebSocket(request, socket, data) {  
  const { 0: client, 1: server } = new WebSocketPair();  
  server.accept();  
  pipeline(server, socket, data);  
  return new Response(null, { status: 101, webSocket: client });  
}  

async function parseVlessHeader(buffer) {  
  const view = new DataView(buffer),  
        bytes = new Uint8Array(buffer),  
        uuidLen = bytes[17],  
        port = view.getUint16(18 + uuidLen + 1),  
        addrType = bytes[18 + uuidLen + 3];  

  let address,  
      offset = 18 + uuidLen + 4;  

  if (addrType === 1) {  
    address = Array.from(bytes.slice(offset, offset + 4)).join('.');  
    offset += 4;  
  } else if (addrType === 2) {  
    const len = bytes[offset];  
    address = new TextDecoder().decode(bytes.slice(offset + 1, offset + 1 + len));  
    offset += len + 1;  
  } else {  
    const v6 = new DataView(buffer);  
    address = Array(8)  
      .fill()  
      .map((_, i) => v6.getUint16(offset + 2 * i).toString(16))  
      .join(':');  
    offset += 16;  
  }  

  const payload = buffer.slice(offset);  

  async function connectSocket(hostname, port) {  
    try {  
      const sock = connect({ hostname, port });  
      await sock.opened;  
      return sock;  
    } catch (err) {  
      console.error('Connection error:', err);  
      throw err;  
    }  
  }  

  let tcpSocket;  
  try {  
    console.log('Connecting to:', address, port);  
    tcpSocket = await connectSocket(address, port);  
  } catch {  
    const [proxyHost, proxyPortStr] = config.proxyIP.split(':');  
    if (!config.enableProxy || !config.proxyIP) throw Error('Connection failed');  
    console.log('Trying proxy:', proxyHost, proxyPortStr || port);  
    try {  
      tcpSocket = await connectSocket(proxyHost, Number(proxyPortStr) || port);  
    } catch {  
      throw Error('Proxy connection failed');  
    }  
  }  

  return { tcpSocket, initialData: payload };  
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

// Another piece of dummy logic  
(() => {  
  const hash = crypto.subtle ? 'available' : 'not available';  
  console.log('Crypto support:', hash);  
})();
