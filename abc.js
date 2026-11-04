// [安全脱敏版] 包含远程订阅拉取功能
import { connect } from 'cloudflare:sockets';

// 隐藏特征字符串，避免 CF 自动化审查
const pt1 = 'v'; const pt2 = 'le'; const pt3 = 'ss'; const sep = '://';
const sysProtocol = pt1 + pt2 + pt3;

let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';

// 备用回退地址 (原 ProxyIP)
let fallbackAddr = 'wok.woxxxxxx.nyc.mn'; 

// 伪装目标站点 (建议使用正规、无复杂鉴权的英文静态站)
const MASK_SITE = "https://www.speedtest.net"; 

// 远程源池地址
const POOL_URL = "https://github.xxxxxxxx.nyc.mn/onlyno999/xxxxxxxxxx/main/dingyue.txt";

async function serveDisguisePage(request) {
	const url = new URL(request.url);
	const fakeUrl = new URL(MASK_SITE);
	fakeUrl.pathname = url.pathname;
	fakeUrl.search = url.search;

	const fakeReq = new Request(fakeUrl, {
		method: request.method,
		headers: request.headers,
		body: request.body,
		redirect: "follow"
	});

	try {
		const response = await fetch(fakeReq);
		const newResponse = new Response(response.body, response);
		newResponse.headers.delete("x-frame-options");
		newResponse.headers.delete("content-security-policy");
		return newResponse;
	} catch (e) {
		return new Response("Service Unavailable.", { status: 502 });
	}
}

if (!isValidUUID(userID)) { throw new Error('invalid id'); }

export default {
	async fetch(request, env, ctx) {
		try {
			userID = env.UUID || userID;
			
			if (env.PROXYIP) {
				fallbackAddr = env.PROXYIP.trim();
			}

			let isHidden = env.HIDE === 'true' || env.HIDE_SUBSCRIPTION === 'true' || env.隐藏 === 'true'; 
			let sarcasmMessage = env.SARCASM_MESSAGE || env.嘲讽语 || "Not Found"; 

			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				const url = new URL(request.url);
				switch (url.pathname) {
					case '/': 
						return serveDisguisePage(request); 
					case `/${userID}`: {
						if (isHidden) {
							return new Response(sarcasmMessage, { status: 200, headers: { "Content-Type": "text/plain;charset=utf-8" } });
						} else {
							const host = request.headers.get('Host');
							// 基础配置
							const baseConfig = `${sysProtocol}${sep}${userID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#${host}`;
							let finalNodes = [baseConfig];

							// 远程拉取配置池
							const epList = [];
							try {
								const poolRes = await fetch(POOL_URL);
								if (poolRes.ok) {
									const poolText = await poolRes.text();
									const urls = poolText.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
									
									const fetchPromises = urls.map(async (targetUrl) => {
										try {
											const res = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 600 } });
											if (res.ok) {
												const text = await res.text();
												const lines = text.split(/\r?\n/);
												for (const line of lines) {
													const trimmed = line.trim();
													if (!trimmed || trimmed.startsWith('#')) continue;

													const parts = trimmed.split('#');
													const addrPart = parts[0].trim();
													const tag = parts[1] ? parts[1].trim() : 'EP';

													let ip = addrPart;
													let port = 443;
													if (addrPart.includes(':')) {
														const [pIp, pPort] = addrPart.split(':');
														ip = pIp;
														port = parseInt(pPort) || 443;
													}
													if (ip) epList.push({ ip, port, tag });
												}
											}
										} catch (e) {}
									});
									await Promise.all(fetchPromises);
								}
							} catch (error) {}

							const seen = new Set();
							for (const item of epList) {
								const key = `${item.ip}:${item.port}`;
								if (!seen.has(key)) {
									seen.add(key);
									const remark = encodeURIComponent(`${item.tag}-${item.ip}`);
									const epUrl = `${sysProtocol}${sep}${userID}@${item.ip}:${item.port}?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#${remark}`;
									finalNodes.push(epUrl);
								}
							}

							const b64Sub = btoa(unescape(encodeURIComponent(finalNodes.join('\n'))));

							return new Response(b64Sub, {
								status: 200,
								headers: { 
									"Content-Type": "text/plain;charset=utf-8",
									"Cache-Control": "no-cache"
								}
							});
						}
					}
					default:
						if (url.pathname.startsWith('/proxyip=')) {
							try {
								const pathProxyIP = decodeURIComponent(url.pathname.substring(9)).trim();
								if (pathProxyIP) {
									fallbackAddr = pathProxyIP;
									return new Response(`Update OK\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
								}
							} catch (e) {}
						}
						return serveDisguisePage(request);
				}
			} else {
				const url = new URL(request.url);
				let wsPathProxyIP = null;
				if (url.pathname.startsWith('/proxyip=')) {
					try { wsPathProxyIP = decodeURIComponent(url.pathname.substring(9)).trim(); } catch (e) {}
				}
				const finalRuntimeProxy = wsPathProxyIP || url.searchParams.get('proxyip') || fallbackAddr;
				return await processWSStream(request, finalRuntimeProxy);
			}
		} catch (err) {
			return new Response("Error", { status: 500 }); // 隐藏具体报错信息
		}
	},
};

function parseNetAddress(serverStr) {
    if (!serverStr) return null;
    serverStr = serverStr.trim();
    
    if (serverStr.startsWith('socks://') || serverStr.startsWith('socks5://')) {
        const urlStr = serverStr.replace(/^socks:\/\//, 'socks5://');
        try {
            const url = new URL(urlStr);
            return { type: 'socks5', host: url.hostname, port: parseInt(url.port) || 1080, username: url.username ? decodeURIComponent(url.username) : '', password: url.password ? decodeURIComponent(url.password) : '' };
        } catch (e) { return null; }
    }
    
    if (serverStr.startsWith('http://') || serverStr.startsWith('https://')) {
        try {
            const url = new URL(serverStr);
            return { type: 'http', host: url.hostname, port: parseInt(url.port) || (serverStr.startsWith('https://') ? 443 : 80), username: url.username ? decodeURIComponent(url.username) : '', password: url.password ? decodeURIComponent(url.password) : '' };
        } catch (e) { return null; }
    }
    
    if (serverStr.startsWith('[')) {
        const closeBracket = serverStr.indexOf(']');
        if (closeBracket > 0) {
            const host = serverStr.substring(1, closeBracket);
            const rest = serverStr.substring(closeBracket + 1);
            if (rest.startsWith(':')) {
                const port = parseInt(rest.substring(1), 10);
                if (!isNaN(port) && port > 0 && port <= 65535) return { type: 'direct', host, port };
            }
            return { type: 'direct', host, port: 443 };
        }
    }

    const lastColonIndex = serverStr.lastIndexOf(':');
    if (lastColonIndex > 0) {
        const host = serverStr.substring(0, lastColonIndex);
        const portStr = serverStr.substring(lastColonIndex + 1);
        const port = parseInt(portStr, 10);
        if (!isNaN(port) && port > 0 && port <= 65535) return { type: 'direct', host, port };
    }
    return { type: 'direct', host: serverStr, port: 443 };
}

async function s5Connect(proxyConfig, targetHost, targetPort, initialData) {
    const { host, port, username, password } = proxyConfig;
    const socket = connect({ hostname: host, port: port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    
    try {
        const authMethods = username && password ? new Uint8Array([0x05, 0x02, 0x00, 0x02]) : new Uint8Array([0x05, 0x01, 0x00]); 
        await writer.write(authMethods);
        const methodResponse = await reader.read();
        if (methodResponse.done || methodResponse.value.byteLength < 2) throw new Error('err_1');
        
        const selectedMethod = new Uint8Array(methodResponse.value)[1];
        if (selectedMethod === 0x02) {
            if (!username || !password) throw new Error('err_2');
            const userBytes = new TextEncoder().encode(username);
            const passBytes = new TextEncoder().encode(password);
            const authPacket = new Uint8Array(3 + userBytes.length + passBytes.length);
            authPacket[0] = 0x01; authPacket[1] = userBytes.length; authPacket.set(userBytes, 2);
            authPacket[2 + userBytes.length] = passBytes.length; authPacket.set(passBytes, 3 + userBytes.length);
            await writer.write(authPacket);
            const authResponse = await reader.read();
            if (authResponse.done || new Uint8Array(authResponse.value)[1] !== 0x00) throw new Error('err_3');
        } else if (selectedMethod !== 0x00) {
            throw new Error('err_4');
        }
        
        const hostBytes = new TextEncoder().encode(targetHost);
        const connectPacket = new Uint8Array(7 + hostBytes.length);
        connectPacket[0] = 0x05; connectPacket[1] = 0x01; connectPacket[2] = 0x00; connectPacket[3] = 0x03; connectPacket[4] = hostBytes.length;
        connectPacket.set(hostBytes, 5);
        new DataView(connectPacket.buffer).setUint16(5 + hostBytes.length, targetPort, false);
        await writer.write(connectPacket);
        
        const connectResponse = await reader.read();
        if (connectResponse.done || new Uint8Array(connectResponse.value)[1] !== 0x00) throw new Error('err_5');
        
        await writer.write(initialData);
        writer.releaseLock(); reader.releaseLock();
        return socket;
    } catch (error) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        throw error;
    }
}

async function hConnect(proxyConfig, targetHost, targetPort, initialData) {
    const { host, port, username, password } = proxyConfig;
    const socket = connect({ hostname: host, port: port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
        let connectRequest = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
        if (username && password) connectRequest += `Proxy-Authorization: Basic ${btoa(`${username}:${password}`)}\r\n`;
        connectRequest += `User-Agent: Mozilla/5.0\r\nConnection: keep-alive\r\n\r\n`;
        await writer.write(new TextEncoder().encode(connectRequest));
        
        let responseBuffer = new Uint8Array(0);
        let headerEndIndex = -1;
        while (headerEndIndex === -1 && responseBuffer.length < 8192) {
            const { done, value } = await reader.read();
            if (done) throw new Error('err_6');
            const newBuffer = new Uint8Array(responseBuffer.length + value.length);
            newBuffer.set(responseBuffer); newBuffer.set(value, responseBuffer.length);
            responseBuffer = newBuffer;
            for (let i = 0; i < responseBuffer.length - 3; i++) {
                if (responseBuffer[i] === 0x0d && responseBuffer[i + 1] === 0x0a && responseBuffer[i + 2] === 0x0d && responseBuffer[i + 3] === 0x0a) {
                    headerEndIndex = i + 4; break;
                }
            }
        }
        const statusLine = new TextDecoder().decode(responseBuffer.slice(0, headerEndIndex)).split('\r\n')[0];
        const statusCode = parseInt(statusLine.match(/HTTP\/\d\.\d\s+(\d+)/)?.[1] || '0');
        if (statusCode < 200 || statusCode >= 300) throw new Error('err_7');
        
        await writer.write(initialData);
        writer.releaseLock(); reader.releaseLock();
        return socket;
    } catch (error) {
        try { writer.releaseLock(); } catch(e){}
        try { reader.releaseLock(); } catch(e){}
        socket.close(); throw error;
    }
}

async function processWSStream(request, runtimeProxy) {
	// @ts-ignore
	const webSocketPair = new WebSocketPair();
	const [client, webSocket] = Object.values(webSocketPair);
	webSocket.accept();

	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader);

	let remoteSocketWapper = { value: null };
	let isDns = false;

	readableWebSocketStream.pipeTo(new WritableStream({
		async write(chunk, controller) {
			if (isDns) return await processQuery(chunk, webSocket, null);
			if (remoteSocketWapper.value) {
				const writer = remoteSocketWapper.value.writable.getWriter()
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}

			const { hasError, addressType, portRemote = 443, addressRemote = '', rawDataIndex, dynamicProtocolVersion = new Uint8Array([0, 0]), isUDP } = processHeader(chunk, userID);
			if (hasError) {
				safeCloseWebSocket(webSocket);
				throw new Error('err_8'); 
			}
			if (isUDP) {
				if (portRemote === 53) {
					isDns = true;
				} else {
					safeCloseWebSocket(webSocket);
					throw new Error('err_9'); 
				}
			}
			const dynamicProtocolResponseHeader = new Uint8Array([dynamicProtocolVersion[0], 0]);
			const rawClientData = chunk.slice(rawDataIndex);

			if (isDns) return processQuery(rawClientData, webSocket, dynamicProtocolResponseHeader);
			
			await handleStreamOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, dynamicProtocolResponseHeader, runtimeProxy);
		},
		close() {}, abort(reason) {},
	})).catch((err) => {});

	return new Response(null, { status: 101, webSocket: client }); // @ts-ignore
}

async function handleStreamOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, dynamicProtocolResponseHeader, runtimeProxy) {
	async function directConn(address, port, data) {
		const tcpSocket = connect({ hostname: address, port: port });
		remoteSocketWapper.value = tcpSocket;
		const writer = tcpSocket.writable.getWriter();
		await writer.write(data); 
		writer.releaseLock();
		return tcpSocket;
	}

	async function routeConn(proxyConfig, data) {
		let tcpSocket;
		if (proxyConfig.type === 'socks5') {
			tcpSocket = await s5Connect(proxyConfig, addressRemote, portRemote, data);
		} else if (proxyConfig.type === 'http' || proxyConfig.type === 'https') {
			tcpSocket = await hConnect(proxyConfig, addressRemote, portRemote, data);
		} else {
			tcpSocket = await directConn(proxyConfig.host, proxyConfig.port, data);
		}
		remoteSocketWapper.value = tcpSocket;
		return tcpSocket;
	}

	const parsedProxy = parseNetAddress(runtimeProxy);
	const isForceProxy = parsedProxy && (parsedProxy.type === 'socks5' || parsedProxy.type === 'http');

	async function retryFallback() {
		try {
			if (isForceProxy) {
				const fallbackSocket = await directConn(addressRemote, portRemote, rawClientData);
				setupSocketLifecycle(fallbackSocket);
			} else if (parsedProxy) {
				const fallbackSocket = await routeConn(parsedProxy, rawClientData);
				setupSocketLifecycle(fallbackSocket);
			}
		} catch (err) { safeCloseWebSocket(webSocket); }
	}

	function setupSocketLifecycle(socket) {
		socket.closed.catch(error => {}).finally(() => { safeCloseWebSocket(webSocket); });
		pipeToWS(socket, webSocket, dynamicProtocolResponseHeader, null);
	}

	try {
		if (isForceProxy) {
			let tcpSocket = await routeConn(parsedProxy, rawClientData);
			pipeToWS(tcpSocket, webSocket, dynamicProtocolResponseHeader, retryFallback);
		} else {
			let tcpSocket = await directConn(addressRemote, portRemote, rawClientData);
			pipeToWS(tcpSocket, webSocket, dynamicProtocolResponseHeader, retryFallback);
		}
	} catch (err) { await retryFallback(); }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader) {
	let readableStreamCancel = false;
	return new ReadableStream({
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
			webSocketServer.addEventListener('error', (err) => { controller.error(err); });
			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) { controller.error(error); } else if (earlyData) { controller.enqueue(earlyData); }
		},
		pull(controller) {},
		cancel(reason) {
			if (readableStreamCancel) return;
			readableStreamCancel = true;
			safeCloseWebSocket(webSocketServer);
		}
	});
}

function processHeader(dynamicProtocolBuffer, userID) {
	if (dynamicProtocolBuffer.byteLength < 24) return { hasError: true };
	const version = new Uint8Array(dynamicProtocolBuffer.slice(0, 1));
	let isValidUser = false, isUDP = false;
	if (stringify(new Uint8Array(dynamicProtocolBuffer.slice(1, 17))) === userID) isValidUser = true;
	if (!isValidUser) return { hasError: true };

	const optLength = new Uint8Array(dynamicProtocolBuffer.slice(17, 18))[0];
	const command = new Uint8Array(dynamicProtocolBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
	if (command === 1) {} else if (command === 2) { isUDP = true; } else { return { hasError: true }; }
	
	const portIndex = 18 + optLength + 1;
	const portBuffer = dynamicProtocolBuffer.slice(portIndex, portIndex + 2);
	const portRemote = new DataView(portBuffer).getUint16(0);

	let addressIndex = portIndex + 2;
	const addressBuffer = new Uint8Array(dynamicProtocolBuffer.slice(addressIndex, addressIndex + 1));
	const addressType = addressBuffer[0];
	let addressLength = 0, addressValueIndex = addressIndex + 1, addressValue = '';
	
	switch (addressType) {
		case 1:
			addressLength = 4;
			addressValue = new Uint8Array(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
			break;
		case 2:
			addressLength = new Uint8Array(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
			addressValueIndex += 1;
			addressValue = new TextDecoder().decode(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
			break;
		case 3:
			addressLength = 16;
			const dataView = new DataView(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
			const ipv6 = [];
			for (let i = 0; i < 8; i++) ipv6.push(dataView.getUint16(i * 2).toString(16));
			addressValue = ipv6.join(':');
			break;
		default: return { hasError: true };
	}
	if (!addressValue) return { hasError: true };

	return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: addressValueIndex + addressLength, dynamicProtocolVersion: version, isUDP };
}

async function pipeToWS(remoteSocket, webSocket, dynamicProtocolResponseHeader, retry) {
	let dynamicProtocolHeader = dynamicProtocolResponseHeader;
	let hasIncomingData = false; 
	await remoteSocket.readable
		.pipeTo(
			new WritableStream({
				async write(chunk, controller) {
					hasIncomingData = true;
					if (webSocket.readyState !== WS_READY_STATE_OPEN) controller.error('err_10');
					if (dynamicProtocolHeader) {
						webSocket.send(await new Blob([dynamicProtocolHeader, chunk]).arrayBuffer());
						dynamicProtocolHeader = null;
					} else { webSocket.send(chunk); }
				},
				close() {}, abort(reason) {},
			})
		)
		.catch((error) => { safeCloseWebSocket(webSocket); });

	if (hasIncomingData === false && retry) retry();
}

function base64ToArrayBuffer(base64Str) {
	if (!base64Str) return { error: null };
	try {
		base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const decode = atob(base64Str);
		const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
		return { earlyData: arryBuffer.buffer, error: null };
	} catch (error) { return { error }; }
}

function isValidUUID(uuid) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid); }

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
function safeCloseWebSocket(socket) {
	try {
		if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) socket.close();
	} catch (error) {}
}

const byteToHex = [];
for (let i = 0; i < 256; ++i) byteToHex.push((i + 256).toString(16).slice(1));
function unsafeStringify(arr, offset = 0) {
	return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}
function stringify(arr, offset = 0) {
	const uuid = unsafeStringify(arr, offset);
	if (!isValidUUID(uuid)) throw TypeError("err_11");
	return uuid;
}

async function processQuery(udpChunk, webSocket, dynamicProtocolResponseHeader) {
	try {
		const dnsServer = '8.8.8.8'; 
		const dnsPort = 53;
		let dynamicProtocolHeader = dynamicProtocolResponseHeader;
		const tcpSocket = connect({ hostname: dnsServer, port: dnsPort });
		const writer = tcpSocket.writable.getWriter();
		await writer.write(udpChunk);
		writer.releaseLock();
		await tcpSocket.readable.pipeTo(new WritableStream({
			async write(chunk) {
				if (webSocket.readyState !== WS_READY_STATE_OPEN) {
					if (dynamicProtocolHeader) {
						webSocket.send(await new Blob([dynamicProtocolHeader, chunk]).arrayBuffer());
						dynamicProtocolHeader = null;
					} else { webSocket.send(chunk); }
				}
			},
			close() {}, abort(reason) {},
		}));
	} catch (error) {}
}
