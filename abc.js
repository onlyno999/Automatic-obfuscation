let 转码 = 'vl', 转码2 = 'ess', 符号 = '://';

// version base on commit 58686d5d125194d34a1137913b3a64ddcf55872f, time is 2024-11-27 09:26:02 UTC.
// @ts-ignore
import { connect } from 'cloudflare:sockets';

// How to generate your own UUID:
// [Windows] Press "Win + R", input cmd and run:  Powershell -NoExit -Command "[guid]::NewGuid()"
let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';

let proxyIP = 'proxyip.zone.id'; // 确保这里有默认值或者通过环境变量设置。
// --- 新增变量来存储 PROXYIP 的端口 ---
let proxyPort = 443; // 默认端口为 443
// --- 结束新增 ---

// --- 新增：伪装页面相关的变量和函数 ---
let disguiseUrl = 'https://cf-worker-dir-bke.pages.dev/'; // 添加伪装页面的URL

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

if (!isValidUUID(userID)) {
	throw new Error('uuid is not valid');
}

export default {
	/**
	 * @param {import("@cloudflare/workers-types").Request} request
	 * @param {{UUID: string, PROXYIP: string, SOCKS5?: string, HIDE_SUBSCRIPTION?: string, SARCASM_MESSAGE?: string, 隐藏?: string, 嘲讽语?: string}} env // 增加了 SOCKS5 及中文环境变量的类型提示
	 * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
	 * @returns {Promise<Response>}
	 */
	async fetch(request, env, ctx) {
		try {
			userID = env.UUID || userID;
			// --- 修改：解析 PROXYIP 环境变量 ---
			if (env.PROXYIP) {
				const parts = env.PROXYIP.split(':');
				proxyIP = parts[0];
				proxyPort = parts.length > 1 ? parseInt(parts[1], 10) : 443;
			}
			// --- 结束修改 ---

            // --- **新增：解析 SOCKS5 环境变量** ---
            // 格式支持: username:password@host:port 或 host:port
            let socks5 = env.SOCKS5 || null;

			// --- **新增逻辑：处理中文环境变量名映射** ---
            // 优先级：先尝试英文变量名 (推荐)，如果不存在，再尝试中文变量名
            let 隐藏 = false; // 默认值
            let 嘲讽语 = "哎呀你找到了我，但是我就是不给你看，气不气，嘿嘿嘿"; // 默认值

            if (env.HIDE_SUBSCRIPTION !== undefined) {
                隐藏 = env.HIDE_SUBSCRIPTION === 'true';
            } else if (env.隐藏 !== undefined) { // 尝试读取中文变量名
                隐藏 = env.隐藏 === 'true';
            }

            if (env.SARCASM_MESSAGE !== undefined) {
                嘲讽语 = env.SARCASM_MESSAGE;
            } else if (env.嘲讽语 !== undefined) { // 尝试读取中文变量名
                嘲讽语 = env.嘲讽语;
            }
            // --- **新增逻辑结束** ---

            // --- **调试日志：请留意这里** ---
            console.log(`环境变量 HIDE_SUBSCRIPTION 原始值 (英文): ${env.HIDE_SUBSCRIPTION}`);
            console.log(`最终解析的布尔值 隐藏: ${隐藏}`);
            console.log(`最终解析的嘲讽语: ${嘲讽语}`);
			console.log(`环境变量 PROXYIP 原始值: ${env.PROXYIP}`);
			console.log(`最终解析的 proxyIP: ${proxyIP}:${proxyPort}`);
            console.log(`SOCKS5 配置状态: ${socks5 ? '已启用' : '未启用'}`);
			// --- 调试日志结束 ---


			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				const url = new URL(request.url);
				switch (url.pathname) {
					case '/': // 处理伪装页面
						return serveDisguisePage(); // 返回伪装页面
					case `/${userID}`: {
						// 根据 隐藏 变量决定是否显示订阅配置
						if (隐藏) {
							// 隐藏模式启动，给个“惊喜”
							return new Response(嘲讽语, {
								status: 200,
								headers: {
									"Content-Type": "text/plain;charset=utf-8",
								}
							});
						} else {
							// 正常展示，无需遮掩
							const dynamicProtocolConfig = getDynamicProtocolConfig(userID, request.headers.get('Host'));
							return new Response(`${dynamicProtocolConfig}`, {
								status: 200,
								headers: {
									"Content-Type": "text/plain;charset=utf-8",
								}
							});
						}
					}
					default:
						return new Response('Not found', { status: 404 });
				}
			} else {
				// 是 WebSocket 请求？那就去处理“秘密隧道”吧
				// 传递 proxyIP, proxyPort 和 socks5 给处理函数
				return await dynamicProtocolOverWSHandler(request, proxyIP, proxyPort, socks5);
			}
		} catch (err) {
			/** @type {Error} */ let e = err;
			// 哎呀，出错了，直接把错误信息吐出来
			return new Response(e.toString());
		}
	},
};

/**
 * * @param {import("@cloudflare/workers-types").Request} request
 * @param {string} fallbackProxyIP // 新增参数，用于回退
 * @param {number} fallbackProxyPort // 新增参数，用于回退
 * @param {string | null} socks5 // 新增参数，SOCKS5代理配置
 */
async function dynamicProtocolOverWSHandler(request, fallbackProxyIP, fallbackProxyPort, socks5) {

	/** @type {import("@cloudflare/workers-types").WebSocket[]} */
	// @ts-ignore
	const webSocketPair = new WebSocketPair();
	const [client, webSocket] = Object.values(webSocketPair);

	webSocket.accept();

	let address = '';
	let portWithRandomLog = '';
	const log = (/** @type {string} */ info, /** @type {string | undefined} */ event) => {
		console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
	};
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

	const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

	/** @type {{ value: import("@cloudflare/workers-types").Socket | null}}*/
	let remoteSocketWapper = {
		value: null,
	};
	let isDns = false;

	// ws --> remote (数据流向：从 WebSocket 到远程目标)
	readableWebSocketStream.pipeTo(new WritableStream({
		async write(chunk, controller) {
			if (isDns) {
				// 如果是 DNS 查询，特殊处理
				return await handleDNSQuery(chunk, webSocket, null, log);
			}
			if (remoteSocketWapper.value) {
				// 远程连接已建立，直接写入数据
				const writer = remoteSocketWapper.value.writable.getWriter()
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}

			// 解析协议头部，这是“解密”的关键一步
			const {
				hasError,
				message,
				addressType,
				portRemote = 443,
				addressRemote = '',
				rawDataIndex,
				dynamicProtocolVersion = new Uint8Array([0, 0]),
				isUDP,
                rawAddressBuffer, // 新增，提取的原始地址字节供 SOCKS5 使用
			} = processDynamicProtocolHeader(chunk, userID);
			address = addressRemote;
			portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '
				} `;
			if (hasError) {
				// 出错？直接中断，不给机会
				log(`Error parsing VLESS header: ${message}`);
				safeCloseWebSocket(webSocket);
				throw new Error(message); 
			}
			// 如果是 UDP 但不是 DNS 端口，就拒绝
			if (isUDP) {
				if (portRemote === 53) {
					isDns = true;
				} else {
					log('UDP proxy only enabled for DNS which is port 53');
					safeCloseWebSocket(webSocket);
					throw new Error('UDP proxy only enable for DNS which is port 53'); 
				}
			}
			// 响应头部，版本信息
			const dynamicProtocolResponseHeader = new Uint8Array([dynamicProtocolVersion[0], 0]);
			const rawClientData = chunk.slice(rawDataIndex);

			if (isDns) {
				return handleDNSQuery(rawClientData, webSocket, dynamicProtocolResponseHeader, log);
			}
			// 处理 TCP 出站连接，加入 socks5 支持
			await handleTCPOutBound(
				remoteSocketWapper, 
				addressType, 
				addressRemote, 
				portRemote, 
				rawClientData, 
				webSocket, 
				dynamicProtocolResponseHeader, 
				log, 
				fallbackProxyIP,
				fallbackProxyPort,
                socks5,
                rawAddressBuffer
			);
		},
		close() {
			log(`readableWebSocketStream is close`);
		},
		abort(reason) {
			log(`readableWebSocketStream is abort`, JSON.stringify(reason));
		},
	})).catch((err) => {
		log('readableWebSocketStream pipeTo error', err);
	});

	return new Response(null, {
		status: 101,
		// @ts-ignore
		webSocket: client,
	});
}

/**
 * Handles outbound TCP connections with SOCKS5 integration.
 *
 * @param {any} remoteSocketWapper
 * @param {number} addressType The remote address type to connect to.
 * @param {string} addressRemote The remote address to connect to.
 * @param {number} portRemote The remote port to connect to.
 * @param {Uint8Array} rawClientData The raw client data to write.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to pass the remote socket to.
 * @param {Uint8Array} dynamicProtocolResponseHeader The dynamicProtocol response header.
 * @param {function} log The logging function.
 * @param {string} fallbackProxyIP The proxy IP to fall back to.
 * @param {number} fallbackProxyPort The proxy port to fall back to.
 * @param {string | null} socks5 SOCKS5 configuration string.
 * @param {Uint8Array} rawAddressBuffer Raw buffer of the address parsed from header.
 * @returns {Promise<void>}
 */
async function handleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, dynamicProtocolResponseHeader, log, fallbackProxyIP, fallbackProxyPort, socks5, rawAddressBuffer) {
	
    async function connectAndWrite(address, port, useFallback = false) {
		let targetHost = address;
		let targetPort = port;
		if (useFallback && fallbackProxyIP) {
			targetHost = fallbackProxyIP;
			targetPort = fallbackProxyPort;
		}

        // --- SOCKS5 代理逻辑 ---
        if (socks5) {
            try {
                log(`Connecting via SOCKS5 proxy: ${socks5}`);
                let socksUsername = '';
                let socksPassword = '';
                let socksHost = '';
                let socksPort = 1080;
                
                // 简易解析 SOCKS5 配置
                const parts = socks5.split('@');
                let hostPort = socks5;
                if (parts.length > 1) {
                    const creds = parts[0].split(':');
                    socksUsername = creds[0];
                    socksPassword = creds[1] || '';
                    hostPort = parts[1];
                }
                const hp = hostPort.split(':');
                socksHost = hp[0];
                socksPort = hp.length > 1 ? parseInt(hp[1], 10) : 1080;

                const tcpSocket = connect({ hostname: socksHost, port: socksPort });
                remoteSocketWapper.value = tcpSocket;
                const writer = tcpSocket.writable.getWriter();
                
                // 1. SOCKS5 Greeting (握手)
                const authMethods = (socksUsername || socksPassword) ? [0x02, 0x00] : [0x00];
                await writer.write(new Uint8Array([0x05, authMethods.length, ...authMethods]));
                
                const reader = tcpSocket.readable.getReader();
                let res = await reader.read();
                if (res.done || res.value[0] !== 0x05) throw new Error('SOCKS5 greeting failed');
                
                // 验证与鉴权
                if (res.value[1] === 0x02) { 
                    const u = new TextEncoder().encode(socksUsername);
                    const p = new TextEncoder().encode(socksPassword);
                    const authReq = new Uint8Array(3 + u.length + p.length);
                    authReq[0] = 0x01; authReq[1] = u.length; authReq.set(u, 2);
                    authReq[2 + u.length] = p.length; authReq.set(p, 3 + u.length);
                    await writer.write(authReq);
                    res = await reader.read();
                    if (res.done || res.value[1] !== 0x00) throw new Error('SOCKS5 auth failed');
                } else if (res.value[1] !== 0x00) {
                    throw new Error('SOCKS5 auth method not supported');
                }
                
                // 2. SOCKS5 CONNECT (连接目标)
                // 转换协议层的 addressType 至 SOCKS5 的 addressType (1=IPv4, 3=Domain, 4=IPv6)
                let socks5AddressType = addressType === 2 ? 0x03 : (addressType === 3 ? 0x04 : 0x01);
                let addressLength = rawAddressBuffer.length;
                let connectReq = new Uint8Array(4 + (addressType === 2 ? 1 : 0) + addressLength + 2);
                connectReq[0] = 0x05; connectReq[1] = 0x01; connectReq[2] = 0x00; connectReq[3] = socks5AddressType;
                
                let offset = 4;
                if (addressType === 2) {
                    connectReq[offset++] = addressLength; // 写入域名长度
                }
                connectReq.set(rawAddressBuffer, offset);
                offset += addressLength;
                connectReq[offset++] = (portRemote >> 8) & 0xFF;
                connectReq[offset++] = portRemote & 0xFF;
                
                await writer.write(connectReq);
                res = await reader.read();
                if (res.done || res.value[0] !== 0x05 || res.value[1] !== 0x00) {
                    throw new Error(`SOCKS5 CONNECT failed`);
                }
                
                // 提取粘包数据（极少数情况下代理端会在回复 CONNECT 后直接附带远端数据）
                let expectedLen = 10;
                if (res.value[3] === 0x03) expectedLen = 4 + 1 + res.value[4] + 2;
                if (res.value[3] === 0x04) expectedLen = 22;
                
                let extraData = null;
                if (res.value.length > expectedLen) {
                    extraData = res.value.slice(expectedLen);
                }
                
                // 释放锁以交还给外层 pipeTo
                reader.releaseLock();
                await writer.write(rawClientData); 
                writer.releaseLock();
                
                return { tcpSocket, extraData };

            } catch (e) {
                log(`SOCKS5 connect error: ${e.message}`);
                throw e; 
            }
        } 
        // --- 正常 / PROXYIP 逻辑 ---
        else {
            const tcpSocket = connect({
                hostname: targetHost,
                port: targetPort,
            });
            remoteSocketWapper.value = tcpSocket;
            log(`connected to ${targetHost}:${targetPort}`);
            const writer = tcpSocket.writable.getWriter();
            await writer.write(rawClientData); 
            writer.releaseLock();
            return { tcpSocket, extraData: null };
        }
	}

	async function retry() {
        let result;
		if (fallbackProxyIP) {
			log(`retrying with proxyIP: ${fallbackProxyIP}:${fallbackProxyPort}`);
			result = await connectAndWrite(addressRemote, portRemote, true);
		} else {
			log(`retrying with original address: ${addressRemote}:${portRemote}`);
			result = await connectAndWrite(addressRemote, portRemote, false);
		}
		
		result.tcpSocket.closed.catch(error => {
			console.log('retry tcpSocket closed error', error);
		}).finally(() => {
			safeCloseWebSocket(webSocket);
		})
		remoteSocketToWS(result.tcpSocket, webSocket, dynamicProtocolResponseHeader, null, log, result.extraData);
	}

	let result = await connectAndWrite(addressRemote, portRemote, false);
	remoteSocketToWS(result.tcpSocket, webSocket, dynamicProtocolResponseHeader, retry, log, result.extraData);
}

/**
 * * @param {import("@cloudflare/workers-types").WebSocket} webSocketServer
 * @param {string} earlyDataHeader for ws 0rtt
 * @param {(info: string)=> void} log for ws 0rtt
 */
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
	let readableStreamCancel = false;
	const stream = new ReadableStream({
		start(controller) {
			webSocketServer.addEventListener('message', (event) => {
				if (readableStreamCancel) {
					return;
				}
				const message = event.data;
				controller.enqueue(message);
			});

			webSocketServer.addEventListener('close', () => {
				safeCloseWebSocket(webSocketServer);
				if (readableStreamCancel) {
					return;
				}
				controller.close();
			}
			);
			webSocketServer.addEventListener('error', (err) => {
				log('webSocketServer has error');
				controller.error(err);
			}
			);
			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) {
				controller.error(error);
			} else if (earlyData) {
				controller.enqueue(earlyData);
			}
		},

		pull(controller) {
		},
		cancel(reason) {
			if (readableStreamCancel) {
				return;
			}
			log(`ReadableStream was canceled, due to ${reason}`)
			readableStreamCancel = true;
			safeCloseWebSocket(webSocketServer);
		}
	});

	return stream;

}

/**
 * * @param { ArrayBuffer} dynamicProtocolBuffer 
 * @param {string} userID 
 * @returns 
 */
function processDynamicProtocolHeader(
	dynamicProtocolBuffer,
	userID
) {
	if (dynamicProtocolBuffer.byteLength < 24) {
		return { hasError: true, message: 'invalid data' };
	}
	const version = new Uint8Array(dynamicProtocolBuffer.slice(0, 1));
	let isValidUser = false;
	let isUDP = false;
	
	if (stringify(new Uint8Array(dynamicProtocolBuffer.slice(1, 17))) === userID) {
		isValidUser = true;
	}
	if (!isValidUser) {
		return { hasError: true, message: 'invalid user' };
	}

	const optLength = new Uint8Array(dynamicProtocolBuffer.slice(17, 18))[0];
	const command = new Uint8Array(
		dynamicProtocolBuffer.slice(18 + optLength, 18 + optLength + 1)
	)[0];

	if (command === 1) {
	} else if (command === 2) {
		isUDP = true;
	} else {
		return {
			hasError: true,
			message: `command ${command} is not support, command 01-tcp,02-udp,03-mux`,
		};
	}
	const portIndex = 18 + optLength + 1;
	const portBuffer = dynamicProtocolBuffer.slice(portIndex, portIndex + 2);
	const portRemote = new DataView(portBuffer).getUint16(0);

	let addressIndex = portIndex + 2;
	const addressBuffer = new Uint8Array(
		dynamicProtocolBuffer.slice(addressIndex, addressIndex + 1)
	);

	const addressType = addressBuffer[0];
	let addressLength = 0;
	let addressValueIndex = addressIndex + 1;
	let addressValue = '';
	switch (addressType) {
		case 1:
			addressLength = 4;
			addressValue = new Uint8Array(
				dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			).join('.');
			break;
		case 2:
			addressLength = new Uint8Array(
				dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + 1)
			)[0];
			addressValueIndex += 1;
			addressValue = new TextDecoder().decode(
				dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			);
			break;
		case 3:
			addressLength = 16;
			const dataView = new DataView(
				dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			);
			const ipv6 = [];
			for (let i = 0; i < 8; i++) {
				ipv6.push(dataView.getUint16(i * 2).toString(16));
			}
			addressValue = ipv6.join(':');
			break;
		default:
			return {
				hasError: true,
				message: `invild  addressType is ${addressType}`,
			};
	}
	if (!addressValue) {
		return {
			hasError: true,
			message: `addressValue is empty, addressType is ${addressType}`,
		};
	}

    // 提取出原生的地址字节，交给 SOCKS5 直接拼接使用，避免复杂的二次序列化
    const rawAddressBuffer = new Uint8Array(dynamicProtocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength));

	return {
		hasError: false,
		addressRemote: addressValue,
		addressType,
		portRemote,
		rawDataIndex: addressValueIndex + addressLength,
		dynamicProtocolVersion: version,
		isUDP,
        rawAddressBuffer // 新增抛出
	};
}


/**
 * * @param {import("@cloudflare/workers-types").Socket} remoteSocket 
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket 
 * @param {ArrayBuffer} dynamicProtocolResponseHeader 
 * @param {(() => Promise<void>) | null} retry
 * @param {*} log 
 * @param {Uint8Array | null} initialData // 可能会在SOCKS5握手时带出的粘包前置数据
 */
async function remoteSocketToWS(remoteSocket, webSocket, dynamicProtocolResponseHeader, retry, log, initialData = null) {
	let remoteChunkCount = 0;
	let chunks = [];
	/** @type {ArrayBuffer | null} */
	let dynamicProtocolHeader = dynamicProtocolResponseHeader;
	let hasIncomingData = false; 

    // 如果 SOCKS5 握手阶段把真实数据连带返回了，提前打回 WS 客户端
    if (initialData && initialData.byteLength > 0) {
        hasIncomingData = true;
        if (dynamicProtocolHeader) {
            webSocket.send(await new Blob([dynamicProtocolHeader, initialData]).arrayBuffer());
            dynamicProtocolHeader = null;
        } else {
            webSocket.send(initialData);
        }
    }

	await remoteSocket.readable
		.pipeTo(
			new WritableStream({
				start() {
				},
				/**
				 * * @param {Uint8Array} chunk 
				 * @param {*} controller 
				 */
				async write(chunk, controller) {
					hasIncomingData = true;
					if (webSocket.readyState !== WS_READY_STATE_OPEN) {
						controller.error(
							'webSocket.readyState is not open, maybe close'
						);
					}
					if (dynamicProtocolHeader) {
						// 首次发送带头部信息
						webSocket.send(await new Blob([dynamicProtocolHeader, chunk]).arrayBuffer());
						dynamicProtocolHeader = null;
					} else {
						// 后续直接发送数据
						webSocket.send(chunk);
					}
				},
				close() {
					log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
				},
				abort(reason) {
					console.error(`remoteConnection!.readable abort`, reason);
				},
			})
		)
		.catch((error) => {
			console.error(
				`remoteSocketToWS has exception `,
				error.stack || error
			);
			safeCloseWebSocket(webSocket);
		});

	// 如果 CF 连接 socket 没有收到任何数据，就尝试重试
	if (hasIncomingData === false && retry) {
		log(`retry`)
		retry();
	}
}

/**
 * * @param {string} base64Str 
 * @returns 
 */
function base64ToArrayBuffer(base64Str) {
	if (!base64Str) {
		return { error: null };
	}
	try {
		base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const decode = atob(base64Str);
		const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
		return { earlyData: arryBuffer.buffer, error: null };
	} catch (error) {
		return { error };
	}
}

/**
 * This is not real UUID validation
 * @param {string} uuid 
 */
function isValidUUID(uuid) {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
/**
 * Normally, WebSocket will not has exceptions when close.
 * @param {import("@cloudflare/workers-types").WebSocket} socket
 */
function safeCloseWebSocket(socket) {
	try {
		if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
			socket.close();
		}
	} catch (error) {
		console.error('safeCloseWebSocket error', error);
	}
}

const byteToHex = [];
for (let i = 0; i < 256; ++i) {
	byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
	return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}
function stringify(arr, offset = 0) {
	const uuid = unsafeStringify(arr, offset);
	if (!isValidUUID(uuid)) {
		throw TypeError("Stringified UUID is invalid");
	}
	return uuid;
}

/**
 * * @param {ArrayBuffer} udpChunk 
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket 
 * @param {ArrayBuffer} dynamicProtocolResponseHeader 
 * @param {(string)=> void} log 
 */
async function handleDNSQuery(udpChunk, webSocket, dynamicProtocolResponseHeader, log) {
	try {
		const dnsServer = '8.8.4.4'; 
		const dnsPort = 53;
		/** @type {ArrayBuffer | null} */
		let dynamicProtocolHeader = dynamicProtocolResponseHeader;
		/** @type {import("@cloudflare/workers-types").Socket} */
		const tcpSocket = connect({
			hostname: dnsServer,
			port: dnsPort,
		});

		log(`connected to ${dnsServer}:${dnsPort}`);
		const writer = tcpSocket.writable.getWriter();
		await writer.write(udpChunk);
		writer.releaseLock();
		await tcpSocket.readable.pipeTo(new WritableStream({
			async write(chunk) {
				if (webSocket.readyState === WS_READY_STATE_OPEN) {
					if (dynamicProtocolHeader) {
						webSocket.send(await new Blob([dynamicProtocolHeader, chunk]).arrayBuffer());
						dynamicProtocolHeader = null;
					} else {
						webSocket.send(chunk);
					}
				}
			},
			close() {
				log(`dns server(${dnsServer}) tcp is close`);
			},
			abort(reason) {
				console.error(`dns server(${dnsServer}) tcp is abort`, reason);
			},
		}));
	} catch (error) {
		console.error(
			`handleDNSQuery have exception, error: ${error.message}`
		);
	}
}

/**
 * * @param {string} userID 
 * * @param {string | null} hostName
 * @returns {string}
 */
function getDynamicProtocolConfig(userID, hostName) {
	const protocol = 转码 + 转码2; 
	const dynamicProtocolMain = 
	`${protocol}${符号}${userID}@${hostName}:443`+
	`?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${hostName}`;
	
	return `
################################################################
v2ray
---------------------------------------------------------------
${dynamicProtocolMain}
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
