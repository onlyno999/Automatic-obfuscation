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

// --- 新增：NAT64 开关变量 ---
let NAT64 = false; // 默认开启 NAT64
// --- 结束新增 ---

// 定义伪装页面的URL和处理函数
let disguiseUrl = 'https://cf-worker-dir-bke.pages.dev'; 

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

if (!isValidUUID(userID)) {
	throw new Error('uuid is not valid');
}

export default {
	/**
	 * @param {import("@cloudflare/workers-types").Request} request
	 * @param {{UUID: string, PROXYIP: string, HIDE_SUBSCRIPTION?: string, SARCASM_MESSAGE?: string, 隐藏?: string, 嘲讽语?: string, NAT64?: string}} env // 增加了 NAT64 变量的类型提示
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

            // --- 新增：读取 NAT64 环境变量 ---
            if (env.NAT64 !== undefined) {
                NAT64 = env.NAT64 === 'true'; // 将字符串 'true' 或 'false' 转换为布尔值
            }
            // --- 结束新增 ---

            // --- **调试日志：请留意这里** ---
            console.log(`环境变量 HIDE_SUBSCRIPTION 原始值 (英文): ${env.HIDE_SUBSCRIPTION}`);
            console.log(`环境变量 隐藏 原始值 (中文): ${env.隐藏}`);
            console.log(`最终解析的布尔值 隐藏: ${隐藏}`);
            console.log(`环境变量 SARCASM_MESSAGE 原始值 (英文): ${env.SARCASM_MESSAGE}`);
            console.log(`环境变量 嘲讽语 原始值 (中文): ${env.嘲讽语}`);
            console.log(`最终解析的嘲讽语: ${嘲讽语}`);
            console.log(`环境变量 NAT64 原始值: ${env.NAT64}`); // 新增调试日志
            console.log(`最终解析的布尔值 NAT64: ${NAT64}`); // 新增调试日志
			// --- 新增调试日志 ---
			console.log(`环境变量 PROXYIP 原始值: ${env.PROXYIP}`);
			console.log(`最终解析的 proxyIP: ${proxyIP}`);
			console.log(`最终解析的 proxyPort: ${proxyPort}`);
			// --- 调试日志结束 ---


			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				const url = new URL(request.url);
				switch (url.pathname) {
					case '/':
						// 当访问根路径时，返回伪装页面
						return serveDisguisePage(); 
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
				// 传递 proxyIP 和 proxyPort 给处理函数
				return await dynamicProtocolOverWSHandler(request, proxyIP, proxyPort);
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
 */
async function dynamicProtocolOverWSHandler(request, fallbackProxyIP, fallbackProxyPort) {

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
			
			// 处理 TCP 出站连接，现在使用整合回退逻辑
			await handleTCPOutBound(
				remoteSocketWapper,
				addressRemote,
				portRemote,
				rawClientData,
				webSocket,
				dynamicProtocolResponseHeader,
				log,
				fallbackProxyIP, // 传递 proxyIP
				fallbackProxyPort, // --- 新增：传递 proxyPort ---
                NAT64 // 传递 NAT64 变量
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
 * Handles outbound TCP connections with a tiered fallback: Direct -> NAT64 -> ProxyIP.
 *
 * @param {any} remoteSocketWapper // Changed name to clearly indicate it's a wrapper
 * @param {string} addressRemote The remote address to connect to. This could be an IPv4 or a domain.
 * @param {number} portRemote The remote port to connect to.
 * @param {Uint8Array} rawClientData The raw client data to write.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to pass the remote socket to.
 * @param {Uint8Array} dynamicProtocolResponseHeader The dynamicProtocol response header.
 * @param {function} log The logging function.
 * @param {string} fallbackProxyIP The proxy IP to fall back to if NAT64 fails.
 * @param {number} fallbackProxyPort The proxy port to fall back to if NAT64 fails. // --- 新增参数 ---
 * @param {boolean} enableNAT64 Whether NAT64 is enabled. // 新增参数
 * @returns {Promise<void>}
 */
async function handleTCPOutBound(remoteSocketWapper, addressRemote, portRemote, rawClientData, webSocket, dynamicProtocolResponseHeader, log, fallbackProxyIP, fallbackProxyPort, enableNAT64) {
	let tcpSocket;
	
	// --- 尝试 1: 直连 ---
	try {
		log(`[Attempt 1/3] Attempting direct connection to ${addressRemote}:${portRemote}`);
		tcpSocket = connect({
			hostname: addressRemote, // 直接使用原始地址
			port: portRemote,
		});
		await tcpSocket.opened; // 等待连接建立
		log(`[Success 1/3] Successfully connected directly to ${addressRemote}:${portRemote}`);

	} catch (directError) {
		console.error(`[Error 1/3] Direct connection failed for ${addressRemote}:${portRemote}:`, directError.stack || directError.message || directError);
		
		// --- 尝试 2: 回退到 NAT64 (如果开启) ---
		if (enableNAT64) { // 检查 NAT64 是否开启
			try {
				log(`[Attempt 2/3] Direct failed, attempting NAT64 connection to ${addressRemote}:${portRemote}`);
				// connectViaNAT64 应该处理 IPv4/域名到 NAT64 IPv6 的转换和连接
				const { tcpSocket: nat64Socket } = await connectViaNAT64(addressRemote, portRemote);
				tcpSocket = nat64Socket;
				log(`[Success 2/3] Successfully connected via NAT64 to ${addressRemote}:${portRemote}`);

			} catch (nat64Error) {
				console.error(`[Error 2/3] NAT64 connection failed for ${addressRemote}:${portRemote}:`, nat64Error.stack || nat64Error.message || nat64Error);
				
				// --- 尝试 3: 回退到 ProxyIP ---
				if (fallbackProxyIP) {
					log(`[Attempt 3/3] NAT64 failed, attempting to fall back to proxyIP: ${fallbackProxyIP}:${fallbackProxyPort}`); // --- 修改：使用 fallbackProxyPort ---
					try {
						tcpSocket = connect({
							hostname: fallbackProxyIP,
							port: fallbackProxyPort, // --- 修改：使用 fallbackProxyPort ---
						});
						await tcpSocket.opened;
						log(`[Success 3/3] Successfully connected via proxyIP to ${fallbackProxyIP}:${fallbackProxyPort}`); // --- 修改：使用 fallbackProxyPort ---
					} catch (proxyIPError) {
						console.error(`[Error 3/3] Fallback to proxyIP failed for ${fallbackProxyIP}:${fallbackProxyPort}:`, proxyIPError.stack || proxyIPError.message || proxyIPError); // --- 修改：使用 fallbackProxyPort ---
						safeCloseWebSocket(webSocket); // 所有尝试都失败，关闭 WebSocket
						return; // 退出函数，不进行后续操作
					}
				} else {
					console.error(`[Error] NAT64 failed and no fallback proxyIP provided. Closing WebSocket.`);
					safeCloseWebSocket(webSocket); // 没有回退选项，直接关闭 WebSocket
					return; // 退出函数
				}
			}
		} else { // 如果 NAT64 未开启，则直接跳过 NAT64 尝试，进入 ProxyIP 尝试
			log(`[Skipping NAT64] NAT64 is disabled, skipping attempt.`);
			// --- 尝试 3: 回退到 ProxyIP ---
			if (fallbackProxyIP) {
				log(`[Attempt 2/2] Direct failed and NAT64 disabled, attempting to fall back to proxyIP: ${fallbackProxyIP}:${fallbackProxyPort}`); // --- 修改：使用 fallbackProxyPort ---
				try {
					tcpSocket = connect({
						hostname: fallbackProxyIP,
						port: fallbackProxyPort, // --- 修改：使用 fallbackProxyPort ---
					});
					await tcpSocket.opened;
					log(`[Success 2/2] Successfully connected via proxyIP to ${fallbackProxyIP}:${fallbackProxyPort}`); // --- 修改：使用 fallbackProxyPort ---
				} catch (proxyIPError) {
					console.error(`[Error 2/2] Fallback to proxyIP failed for ${fallbackProxyIP}:${fallbackProxyPort}:`, proxyIPError.stack || proxyIPError.message || proxyIPError); // --- 修改：使用 fallbackProxyPort ---
					safeCloseWebSocket(webSocket); // 所有尝试都失败，关闭 WebSocket
					return; // 退出函数，不进行后续操作
				}
			} else {
				console.error(`[Error] Direct connection failed, NAT64 is disabled, and no fallback proxyIP provided. Closing WebSocket.`);
				safeCloseWebSocket(webSocket); // 没有回退选项，直接关闭 WebSocket
				return; // 退出函数
			}
		}
	}

    // 如果上面任何一种方式成功建立了 tcpSocket
    if (tcpSocket) {
        remoteSocketWapper.value = tcpSocket; // 更新外部的 remoteSocketWapper 引用
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData); // 写入初始客户端数据（例如 TLS 握手）
        writer.releaseLock();

        // 将远程 Socket 的数据流向 WebSocket
        // 注意：这里不再传递 retry 函数，因为回退逻辑已集中在 handleTCPOutBound 内部
        remoteSocketToWS(tcpSocket, webSocket, dynamicProtocolResponseHeader, null, log);
    } else {
        // 这通常不应该发生，但以防万一
        console.error("No TCP socket established after all connection attempts. Closing WebSocket.");
        safeCloseWebSocket(webSocket);
    }
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

			// The event means that the client closed the client -> server stream.
			// However, the server -> client stream is still open until you call close() on the server side.
			// The WebSocket protocol says that a separate close message must be sent in each direction to fully close the socket.
			webSocketServer.addEventListener('close', () => {
				// 客户端发来关闭请求，需要服务器也关闭
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
			// 处理 WebSocket 0-RTT 的早期数据
			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) {
				controller.error(error);
			} else if (earlyData) {
				controller.enqueue(earlyData);
			}
		},

		pull(controller) {
			// 如果 WebSocket 可以停止读取（当流满时），我们可以实现背压
			// https://streams.spec.whatwg.org/#example-rs-push-backpressure
		},
		cancel(reason) {
			// 流被取消了，多半是出问题了
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

// https://xtls.github.io/development/protocols/dynamicProtocol.html
// https://github.com/zizifn/excalidraw-backup/blob/main/v2ray-protocol.excalidraw

/**
 * * @param { ArrayBuffer} dynamicProtocolBuffer 
 * @param {string} userID 
 * @returns 
 */
function processDynamicProtocolHeader(
	dynamicProtocolBuffer,
	userID
) {
	// 协议头部解析，这是“身份验证”与“路由”的关键
	if (dynamicProtocolBuffer.byteLength < 24) {
		return {
			hasError: true,
			message: 'invalid data',
		};
	}
	const version = new Uint8Array(dynamicProtocolBuffer.slice(0, 1));
	let isValidUser = false;
	let isUDP = false;
	// 校验用户 ID，确保是“自家兄弟”
	if (stringify(new Uint8Array(dynamicProtocolBuffer.slice(1, 17))) === userID) {
		isValidUser = true;
	}
	if (!isValidUser) {
		return {
			hasError: true,
			message: 'invalid user',
		};
	}

	const optLength = new Uint8Array(dynamicProtocolBuffer.slice(17, 18))[0];
	//skip opt for now

	const command = new Uint8Array(
		dynamicProtocolBuffer.slice(18 + optLength, 18 + optLength + 1)
	)[0];

	// 0x01 TCP
	// 0x02 UDP
	// 0x03 MUX
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
	// 端口是大端序
	const portRemote = new DataView(portBuffer).getUint16(0);

	let addressIndex = portIndex + 2;
	const addressBuffer = new Uint8Array(
		dynamicProtocolBuffer.slice(addressIndex, addressIndex + 1)
	);

	// 1--> ipv4  addressLength =4
	// 2--> domain name
	// 3--> ipv6  addressLength =16
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
			// 2001:0db8:85a3:0000:0000:8a2e:0370:7334
			const ipv6 = [];
			for (let i = 0; i < 8; i++) {
				ipv6.push(dataView.getUint16(i * 2).toString(16));
			}
			addressValue = ipv6.join(':');
			// seems no need add [] for ipv6
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

	return {
		hasError: false,
		addressRemote: addressValue,
		addressType,
		portRemote,
		rawDataIndex: addressValueIndex + addressLength,
		dynamicProtocolVersion: version,
		isUDP,
	};
}


/**
 * * @param {import("@cloudflare/workers-types").Socket} remoteSocket 
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket 
 * @param {ArrayBuffer} dynamicProtocolResponseHeader 
 * @param {(() => Promise<void>) | null} retry // 这个参数现在不再使用，但保留了签名
 * @param {*} log 
 */
async function remoteSocketToWS(remoteSocket, webSocket, dynamicProtocolResponseHeader, retry, log) {
	// remote--> ws (数据流向：从远程目标到 WebSocket)
	/** @type {ArrayBuffer | null} */
	let dynamicProtocolHeader = dynamicProtocolResponseHeader;
	let hasIncomingData = false; // 检查远程 Socket 是否有传入数据
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
					// 远程连接关闭，关闭 WebSocket
					safeCloseWebSocket(webSocket);
				},
				abort(reason) {
					console.error(`remoteConnection!.readable abort`, reason);
					safeCloseWebSocket(webSocket); // 远程连接中断，关闭 WebSocket
				},
			})
		)
		.catch((error) => {
			console.error(
				`remoteSocketToWS has exception `,
				error.stack || error
			);
			safeCloseWebSocket(webSocket); // 发生异常，关闭 WebSocket
		});

	// !!! IMPORTANT: The retry fallback logic is now handled in handleTCPOutBound
	// This block is intentionally removed as it would conflict with the new logic.
	// if (hasIncomingData === false && retry) {
	// 	log(`retry`)
	// 	retry();
	// }
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
		// Base64 解码，处理 URL 安全字符
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
	// UUID 格式校验，确保是“合法身份”
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
		// 安全关闭 WebSocket，避免“意外”
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
	// DNS 查询处理，始终使用硬编码的 DNS 服务器
	try {
		const dnsServer = '8.8.8.8'; 
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
	// 生成 V2Ray 和 Clash-Meta 配置，这是“订阅信息”的载体
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

// --- NAT64 辅助函数 (这些是唯一应该保留的定义) ---

// 将IPv4地址转换为NAT64 IPv6地址
function convertToNAT64IPv6(ipv4Address) {
    const parts = ipv4Address.split('.');
    if (parts.length !== 4) {
        throw new Error('Invalid IPv4 address format for NAT64 conversion.');
    }
    
    const hex = parts.map(part => {
        const num = parseInt(part, 10);
        if (num < 0 || num > 255) {
            throw new Error('Invalid IPv4 address segment for NAT64 conversion.');
        }
        return num.toString(16).padStart(2, '0');
    });
    
    return `2602:fc59:b0:64::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
}

// 获取域名的IPv4地址并转换为NAT64 IPv6地址
async function getNAT64IPv6FromDomain(domain) {
    // 为 fetch 请求定义一个超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 秒超时

    try {
        const dnsQuery = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=A`, {
            headers: {
                'Accept': 'application/dns-json'
            },
            signal: controller.signal // 应用 AbortController 信号
        });
        
        clearTimeout(timeoutId); // 如果 fetch 在时间内完成，则清除超时

        if (!dnsQuery.ok) {
            throw new Error(`DNS query failed with status: ${dnsQuery.status}`);
        }

        const dnsResult = await dnsQuery.json();
        if (dnsResult.Answer && dnsResult.Answer.length > 0) {
            const aRecord = dnsResult.Answer.find(record => record.type === 1);
            if (aRecord) {
                const ipv4Address = aRecord.data;
                return convertToNAT64IPv6(ipv4Address);
            }
        }
        throw new Error('No A record found for domain or unable to resolve IPv4 address.');
    } catch (err) {
        clearTimeout(timeoutId); // 确保在错误时也清除超时
        if (err.name === 'AbortError') {
            throw new Error(`DNS resolution for NAT64 timed out for domain: ${domain}`);
        }
        throw new Error(`DNS resolution for NAT64 failed: ${err.message}`);
    }
}

// 结合 NAT64 转换和连接的函数
async function connectViaNAT64(address, port) {
    let nat64Address;
    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

    if (ipv4Regex.test(address)) {
        nat64Address = convertToNAT64IPv6(address);
    } else {
        nat64Address = await getNAT64IPv6FromDomain(address);
    }

    const tcpSocket = connect({
        hostname: `[${nat64Address}]`, // IPv6 地址需要方括号
        port: port,
    });
    await tcpSocket.opened;
    return { tcpSocket }; 
	}
