let 转码 = 'vl', 转码2 = 'ess', 符号 = '://';

// version base on commit 58686d5d125194d34a1137913b3a64ddcf55872f, time is 2024-11-27 09:26:02 UTC.
// @ts-ignore
import { connect } from 'cloudflare:sockets';

// How to generate your own UUID:
// [Windows] Press "Win + R", input cmd and run:  Powershell -NoExit -Command "[guid]::NewGuid()"
let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';

let proxyIP = 'proxyip.zone.id'; 
let proxyPort = 443; 

// --- 新增：伪装页面相关的变量和函数 ---
let disguiseUrl = 'https://cf-worker-dir-bke.pages.dev/'; 

async function serveDisguisePage() {
  try {
    const res = await fetch(disguiseUrl, { cf: { cacheEverything: true } });
    return new Response(res.body, res);
  } catch {
    return new Response(
      `<!DOCTYPE html>
       <html>
         <head><title>Welcome</title></head>
         <body><h1>Cloudflare Worker 已部署成功</h1>
         <p>此页面为静态伪装页面（远程加载失败）。</p></body>
       </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }
}
// --- 结束新增 ---

// --- 新增：SOCKS5 连接与鉴权逻辑 ---
function parsePryAddress(serverStr) {
    if (!serverStr) return null;
    serverStr = serverStr.trim();
    if (serverStr.startsWith('socks://') || serverStr.startsWith('socks5://')) {
        const urlStr = serverStr.replace(/^socks:\/\//, 'socks5://');
        try {
            const url = new URL(urlStr);
            return { type: 'socks5', host: url.hostname, port: parseInt(url.port) || 1080, username: url.username ? decodeURIComponent(url.username) : '', password: url.password ? decodeURIComponent(url.password) : '' };
        } catch (e) { return null; }
    }
    return { type: 'direct', host: serverStr, port: 443 };
}

async function connect2Socks5(proxyConfig, targetHost, targetPort, initialData) {
    const { host, port, username, password } = proxyConfig;
    const socket = connect({ hostname: host, port: port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    
    try {
        const authMethods = (username && password) ? new Uint8Array([0x05, 0x02, 0x00, 0x02]) : new Uint8Array([0x05, 0x01, 0x00]);
        await writer.write(authMethods);
        const methodResponse = await reader.read();
        
        const selectedMethod = new Uint8Array(methodResponse.value)[1];
        if (selectedMethod === 0x02) {
            const userBytes = new TextEncoder().encode(username);
            const passBytes = new TextEncoder().encode(password);
            const authPacket = new Uint8Array(3 + userBytes.length + passBytes.length);
            authPacket[0] = 0x01; authPacket[1] = userBytes.length; authPacket.set(userBytes, 2);
            authPacket[2 + userBytes.length] = passBytes.length; authPacket.set(passBytes, 3 + userBytes.length);
            await writer.write(authPacket);
            await reader.read(); 
        }
        
        const hostBytes = new TextEncoder().encode(targetHost);
        const connectPacket = new Uint8Array(7 + hostBytes.length);
        connectPacket[0] = 0x05; connectPacket[1] = 0x01; connectPacket[2] = 0x00; connectPacket[3] = 0x03;
        connectPacket[4] = hostBytes.length; connectPacket.set(hostBytes, 5);
        new DataView(connectPacket.buffer).setUint16(5 + hostBytes.length, targetPort, false);
        await writer.write(connectPacket);
        await writer.write(initialData);
        writer.releaseLock(); reader.releaseLock();
        return socket;
    } catch (e) { throw e; }
}
// --- 结束新增 ---

if (!isValidUUID(userID)) {
	throw new Error('uuid is not valid');
}

export default {
	async fetch(request, env, ctx) {
		try {
			userID = env.UUID || userID;
			if (env.PROXYIP) {
				const parts = env.PROXYIP.split(':');
				proxyIP = parts[0];
				proxyPort = parts.length > 1 ? parseInt(parts[1], 10) : 443;
			}

            let 隐藏 = false; 
            let 嘲讽语 = "哎呀你找到了我，但是我就是不给你看，气不气，嘿嘿嘿"; 

            if (env.HIDE_SUBSCRIPTION !== undefined) {
                隐藏 = env.HIDE_SUBSCRIPTION === 'true';
            } else if (env.隐藏 !== undefined) {
                隐藏 = env.隐藏 === 'true';
            }

            if (env.SARCASM_MESSAGE !== undefined) {
                嘲讽语 = env.SARCASM_MESSAGE;
            } else if (env.嘲讽语 !== undefined) {
                嘲讽语 = env.嘲讽语;
            }

			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				const url = new URL(request.url);
				switch (url.pathname) {
					case '/': 
						return serveDisguisePage(); 
					case `/${userID}`: {
						if (隐藏) {
							return new Response(嘲讽语, {
								status: 200,
								headers: { "Content-Type": "text/plain;charset=utf-8" }
							});
						} else {
							const dynamicProtocolConfig = getDynamicProtocolConfig(userID, request.headers.get('Host'));
							return new Response(`${dynamicProtocolConfig}`, {
								status: 200,
								headers: { "Content-Type": "text/plain;charset=utf-8" }
							});
						}
					}
					default:
						return new Response('Not found', { status: 404 });
				}
			} else {
				return await dynamicProtocolOverWSHandler(request, proxyIP, proxyPort);
			}
		} catch (err) {
			/** @type {Error} */ let e = err;
			return new Response(e.toString());
		}
	},
};

async function dynamicProtocolOverWSHandler(request, fallbackProxyIP, fallbackProxyPort) {
	const webSocketPair = new WebSocketPair();
	const [client, webSocket] = Object.values(webSocketPair);
	webSocket.accept();

	let address = '';
	let portWithRandomLog = '';
	const log = (info, event) => { console.log(`[${address}:${portWithRandomLog}] ${info}`, event || ''); };
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

	let remoteSocketWapper = { value: null };
	let isDns = false;

	readableWebSocketStream.pipeTo(new WritableStream({
		async write(chunk, controller) {
			if (isDns) return await handleDNSQuery(chunk, webSocket, null, log);
			if (remoteSocketWapper.value) {
				const writer = remoteSocketWapper.value.writable.getWriter();
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}

			const { hasError, message, addressType, portRemote = 443, addressRemote = '', rawDataIndex, dynamicProtocolVersion = new Uint8Array([0, 0]), isUDP } = processDynamicProtocolHeader(chunk, userID);
			address = addressRemote;
			portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '}`;
			if (hasError) {
				log(`Error parsing VLESS header: ${message}`);
				safeCloseWebSocket(webSocket);
				throw new Error(message); 
			}
			if (isUDP) {
				if (portRemote === 53) isDns = true;
				else {
					log('UDP proxy only enabled for DNS which is port 53');
					safeCloseWebSocket(webSocket);
					throw new Error('UDP proxy only enable for DNS which is port 53'); 
				}
			}
			const dynamicProtocolResponseHeader = new Uint8Array([dynamicProtocolVersion[0], 0]);
			const rawClientData = chunk.slice(rawDataIndex);

			if (isDns) return handleDNSQuery(rawClientData, webSocket, dynamicProtocolResponseHeader, log);
			await handleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, dynamicProtocolResponseHeader, log, fallbackProxyIP, fallbackProxyPort);
		},
		close() { log(`readableWebSocketStream is close`); },
		abort(reason) { log(`readableWebSocketStream is abort`, JSON.stringify(reason)); },
	})).catch((err) => { log('readableWebSocketStream pipeTo error', err); });

	return new Response(null, { status: 101, webSocket: client });
}

async function handleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, dynamicProtocolResponseHeader, log, fallbackProxyIP, fallbackProxyPort) {
    // [MODIFIED] 这里使用了 SOCKS5 代理判断逻辑
    const proxyConfig = fallbackProxyIP ? parsePryAddress(`socks5://${fallbackProxyIP}:${fallbackProxyPort}`) : null;
    
	async function connectAndWrite(address, port) {
        let tcpSocket;
        if (proxyConfig && proxyConfig.type === 'socks5') {
            log(`connecting via SOCKS5 proxy: ${proxyConfig.host}:${proxyConfig.port}`);
            tcpSocket = await connect2Socks5(proxyConfig, address, port, rawClientData);
        } else {
            tcpSocket = connect({ hostname: address, port: port });
            const writer = tcpSocket.writable.getWriter();
            await writer.write(rawClientData); 
            writer.releaseLock();
        }
		remoteSocketWapper.value = tcpSocket;
		log(`connected to ${address}:${port}`);
		return tcpSocket;
	}

	async function retry() {
		log(`retrying with original address: ${addressRemote}:${portRemote}`);
		let tcpSocket = await connectAndWrite(addressRemote, portRemote);
		tcpSocket.closed.catch(error => { console.log('retry tcpSocket closed error', error); }).finally(() => { safeCloseWebSocket(webSocket); });
		remoteSocketToWS(tcpSocket, webSocket, dynamicProtocolResponseHeader, null, log);
	}

	let tcpSocket = await connectAndWrite(addressRemote, portRemote);
	remoteSocketToWS(tcpSocket, webSocket, dynamicProtocolResponseHeader, retry, log);
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
	let readableStreamCancel = false;
	const stream = new ReadableStream({
		start(controller) {
			webSocketServer.addEventListener('message', (event) => {
				if (readableStreamCancel) return;
				controller.enqueue(event.data);
			});
			webSocketServer.addEventListener('close', () => {
				safeCloseWebSocket(webSocketServer);
				if (readableStreamCancel) return;
				controller.close();
			});
			webSocketServer.addEventListener('error', (err) => {
				log('webSocketServer has error');
				controller.error(err);
			});
			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) controller.error(error);
			else if (earlyData) controller.enqueue(earlyData);
		},
		cancel(reason) {
			if (readableStreamCancel) return;
			log(`ReadableStream was canceled, due to ${reason}`)
			readableStreamCancel = true;
			safeCloseWebSocket(webSocketServer);
		}
	});
	return stream;
}

function processDynamicProtocolHeader(dynamicProtocolBuffer, userID) {
	if (dynamicProtocolBuffer.byteLength < 24) return { hasError: true, message: 'invalid data' };
	const version = new Uint8Array(dynamicProtocolBuffer.slice(0, 1));
	let isValidUser = false;
	if (stringify(new Uint8Array(dynamicProtocolBuffer.slice(1, 17))) === userID) isValidUser = true;
	if (!isValidUser) return { hasError: true, message: 'invalid user' };
	const optLength = new Uint8Array(dynamicProtocolBuffer.slice(17, 18))[0];
	const command = new Uint8Array(dynamicProtocolBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
	let isUDP = false;
	if (command === 1) {} else if (command === 2) { isUDP = true; }
	else return { hasError: true, message: `command ${command} is not support, command 01-tcp,02-udp,03-mux` };
	const portIndex = 18 + optLength + 1;
	const portRemote = new DataView(dynamicProtocolBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
	let addressIndex = portIndex + 2;
	const addressType = new Uint8Array(dynamicProtocolBuffer.slice(addressIndex, addressIndex + 1))[0];
	let addressLength = 0, addressValueIndex = addressIndex + 1, addressValue = '';
	switch (addressType) {
		case 1: addressLength = 4; addressValue = new Uint8Array(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.'); break;
		case 2: addressLength = new Uint8Array(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]; addressValueIndex += 1; addressValue = new TextDecoder().decode(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); break;
		case 3: addressLength = 16; const dataView = new DataView(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); const ipv6 = []; for (let i = 0; i < 8; i++) ipv6.push(dataView.getUint16(i * 2).toString(16)); addressValue = ipv6.join(':'); break;
		default: return { hasError: true, message: `invild  addressType is ${addressType}` };
	}
	if (!addressValue) return { hasError: true, message: `addressValue is empty, addressType is ${addressType}` };
	return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: addressValueIndex + addressLength, dynamicProtocolVersion: version, isUDP };
}

async function remoteSocketToWS(remoteSocket, webSocket, dynamicProtocolResponseHeader, retry, log) {
	let dynamicProtocolHeader = dynamicProtocolResponseHeader;
	let hasIncomingData = false; 
	await remoteSocket.readable.pipeTo(
		new WritableStream({
			async write(chunk, controller) {
				hasIncomingData = true;
				if (webSocket.readyState !== WS_READY_STATE_OPEN) controller.error('webSocket.readyState is not open');
				if (dynamicProtocolHeader) {
					webSocket.send(await new Blob([dynamicProtocolHeader, chunk]).arrayBuffer());
					dynamicProtocolHeader = null;
				} else webSocket.send(chunk);
			},
			close() { log(`remoteConnection!.readable is close`); },
		})
	).catch((error) => { console.error(error); safeCloseWebSocket(webSocket); });
	if (hasIncomingData === false && retry) { log(`retry`); retry(); }
}

function base64ToArrayBuffer(base64Str) {
	if (!base64Str) return { error: null };
	try {
		base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const decode = atob(base64Str);
		return { earlyData: Uint8Array.from(decode, (c) => c.charCodeAt(0)).buffer, error: null };
	} catch (error) { return { error }; }
}

function isValidUUID(uuid) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
function safeCloseWebSocket(socket) {
	try { if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) socket.close(); }
	catch (error) { console.error('safeCloseWebSocket error', error); }
}

function stringify(arr, offset = 0) {
    const byteToHex = [];
    for (let i = 0; i < 256; ++i) byteToHex.push((i + 256).toString(16).slice(1));
	const uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
	if (!isValidUUID(uuid)) throw TypeError("Stringified UUID is invalid");
	return uuid;
}

async function handleDNSQuery(udpChunk, webSocket, dynamicProtocolResponseHeader, log) {
	try {
		const tcpSocket = connect({ hostname: '8.8.4.4', port: 53 });
		let dynamicProtocolHeader = dynamicProtocolResponseHeader;
		const writer = tcpSocket.writable.getWriter();
		await writer.write(udpChunk);
		writer.releaseLock();
		await tcpSocket.readable.pipeTo(new WritableStream({
			async write(chunk) {
				if (webSocket.readyState === WS_READY_STATE_OPEN) {
					if (dynamicProtocolHeader) {
						webSocket.send(await new Blob([dynamicProtocolHeader, chunk]).arrayBuffer());
						dynamicProtocolHeader = null;
					} else webSocket.send(chunk);
				}
			},
		}));
	} catch (error) { console.error(error); }
}

function getDynamicProtocolConfig(userID, hostName) {
	return `
################################################################
v2ray
---------------------------------------------------------------
${转码 + 转码2}${符号}${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}
---------------------------------------------------------------
################################################################
clash-meta
---------------------------------------------------------------
- type: ${转码 + 转码2}
  name: ${hostName}
  server: ${hostName}
  port: 443
  uuid: ${userID}
  network: ws
  tls: true
  udp: false
  sni: ${hostName}
  client-fingerprint: chrome
  ws-opts:
    path: "/?ed=2048"
    headers:
      host: ${hostName}
---------------------------------------------------------------
################################################################
`;
}
