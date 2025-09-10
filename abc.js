// ====================================================================
// Cloudflare Worker: VL over WebSocket + SOCKS5 (带并发SOCKS5代理选择)
// --------------------------------------------------------------------

// 环境变量 (Vars) 说明：
//   UUID        必填，VL 用户的 UUID
//   ID          可选，订阅路径 (默认 123456)
//   SOCKS5_ADDRESS	可选 user:pass@127.0.0.1:1080 作为 SOCKS5_TXT_URL 加载失败时的备用
//   SOCKS5_TXT_URL 可选 例如：https://example.com/socks5_list.txt
//   SOCKS5_CONNECT_TIMEOUT = 5000; // SOCKS5 连接超时 (毫秒) 可选，SOCKS5 地址列表 TXT 文件的 URL
//   SOCKS5_ENABLE 可选，true|false，true启用SOCKS5反代，false不启用 (默认 true)
//   SOCKS5_GLOBAL 可选，true|false，true启用SOCKS5全局反代，false仅在直连失败时尝试 (默认 true)
//   隐藏        可选，true|false，true 时订阅接口只返回嘲讽语.
//   私钥        可选，用于 WS 连接认证的私钥
//   私钥开关    可选，true|false，是否启用私钥认证
//   嘲讽语      可选，隐藏订阅时返回的嘲讽语
//
// ====================================================================

import { connect } from 'cloudflare:sockets';

let 转码 = 'vl', 转码2 = 'ess', 符号 = '://';

//////////////////////////////////////////////////////////////////////////配置区块////////////////////////////////////////////////////////////////////////
let 哎呀呀这是我的ID啊 = "123456"; // 订阅路径
let 哎呀呀这是我的VL密钥 = "25dce6e6-1c37-4e8c-806b-5ef8affd9f55"; // UUID

let 私钥开关 = false;
let 咦这是我的私钥哎 = "";

let 隐藏订阅 = false; // 开启 true ━ 关闭false
let 嘲讽语 = "哎呀你找到了我，但是我就是不给你看，气不气，嘿嘿嘿";

let 我的优选 = ['cloudflare-ddns.zone.id:443#美国 域名 默认值 — Cloudflare CDN 节点']; // 可通过环境变量 IP 配置，也可以通过 TXT 配置
let 我的优选TXT = ['']; // 可通过环境变量 TXT 配置，用于从远程文件加载优选 IP

let 我的节点名字 = 'SOCKS5版';

// 新增SOCKS5相关配置
let 启用SOCKS5反代 = true; // 选择是否启用SOCKS5反代功能，true启用，false不启用，可以通过环境变量SOCKS5_ENABLE控制
let 启用SOCKS5全局反代 = true; // 选择是否启用SOCKS5全局反代，启用后所有访问都是S5的落地，可以通过环境变量SOCKS5_GLOBAL控制
let 我的SOCKS5账号 = ''; // 格式'账号:密码@地址:端口'，可以通过环境变量SOCKS5_ADDRESS控制

// 新增：SOCKS5 地址列表 URL
let SOCKS5地址列表URL = ''; // 可以通过环境变量 SOCKS5_TXT_URL 控制

// SOCKS5 地址池和当前索引 (在并发模式下，索引更多用于初始加载后的顺序，实际连接由 Promise.any 管理)
let SOCKS5地址池 = [];
let SOCKS5地址列表上次更新时间 = 0;
const SOCKS5地址列表刷新间隔 = 5 * 60 * 1000; // 5分钟刷新一次 (毫秒)
const SOCKS5_CONNECT_TIMEOUT = 5000; // SOCKS5 连接超时 (毫秒)

let DOH服务器列表 = [ //DOH地址，基本上已经涵盖市面上所有通用地址了，一般无需修改
  "https://dns.google/dns-query",
  "https://cloudflare-dns.com/dns-query",
  "https://1.1.1.1/dns-query",
  "https://dns.quad9.net/dns-query",
];

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

const 读取环境变量 = (name, fallback, env) => {
  const raw = import.meta?.env?.[name] ?? env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed.includes('\n')) {
      return trimmed.split('\n').map(item => item.trim()).filter(Boolean);
    }
    if (!isNaN(trimmed) && trimmed !== '') return Number(trimmed);
    return trimmed;
  }
  return raw;
};

// 新增：加载 SOCKS5 地址列表的函数
async function 加载SOCKS5地址列表() {
  if (!SOCKS5地址列表URL) {
    console.log('SOCKS5_TXT_URL 未配置，不加载 SOCKS5 地址列表。');
    return;
  }

  const currentTime = Date.now();
  if (currentTime - SOCKS5地址列表上次更新时间 < SOCKS5地址列表刷新间隔 && SOCKS5地址池.length > 0) {
    // 还没到刷新时间，且地址池不为空，则不刷新
    return;
  }

  console.log('正在加载 SOCKS5 地址列表...');
  try {
    const response = await fetch(SOCKS5地址列表URL);
    if (!response.ok) {
      throw new Error(`无法加载 SOCKS5 地址列表: ${response.statusText} (Status: ${response.status})`);
    }
    const text = await response.text();
    // 过滤空行、只含空格的行和以 # 开头的注释行
    const addresses = text.split('\n')
                           .map(line => line.trim())
                           .filter(line => line && !line.startsWith('#'));

    if (addresses.length > 0) {
      SOCKS5地址池 = addresses;
      SOCKS5地址列表上次更新时间 = currentTime;
      console.log(`成功加载 ${SOCKS5地址池.length} 个 SOCKS5 地址。`);
    } else {
      console.warn('SOCKS5 地址列表文件为空或不含有效地址。将保留上次成功的列表（如果存在）。');
      // 如果文件内容为空，不清空当前的 SOCKS5地址池，保留上次成功的
    }
  } catch (e) {
    console.error(`加载 SOCKS5 地址列表失败: ${e.message}。将使用备用 SOCKS5_ADDRESS (如果已配置) 或上次成功加载的列表。`);
    // 即使加载失败，也保留旧的地址池，或者在地址池为空时，尝试 fallback 到 SOCKS5_ADDRESS
  }
}

export default {
  async fetch(访问请求, env) {
    // 读取配置区块中的环境变量
    哎呀呀这是我的ID啊 = 读取环境变量('ID', 哎呀呀这是我的ID啊, env);
    哎呀呀这是我的VL密钥 = 读取环境变量('UUID', 哎呀呀这是我的VL密钥, env);
    我的优选 = 读取环境变量('IP', 我的优选, env);
    我的优选TXT = 读取环境变量('TXT', 我的优选TXT, env);
    咦这是我的私钥哎 = 读取环境变量('私钥', 咦这是我的私钥哎, env);
    隐藏订阅 = 读取环境变量('隐藏', 隐藏订阅, env);
    私钥开关 = 读取环境变量('私钥开关', 私钥开关, env);
    嘲讽语 = 读取环境变量('嘲讽语', 嘲讽语, env);
    我的节点名字 = 读取环境变量('我的节点名字', 我的节点名字, env);

    // 读取SOCKS5相关的环境变量
    启用SOCKS5反代 = 读取环境变量('SOCKS5_ENABLE', 启用SOCKS5反代, env);
    启用SOCKS5全局反代 = 读取环境变量('SOCKS5_GLOBAL', 启用SOCKS5全局反代, env);
    我的SOCKS5账号 = 读取环境变量('SOCKS5_ADDRESS', 我的SOCKS5账号, env);
    SOCKS5地址列表URL = 读取环境变量('SOCKS5_TXT_URL', SOCKS5地址列表URL, env); // 读取新的环境变量

    // 尝试加载 SOCKS5 地址列表
    await 加载SOCKS5地址列表();

    const 升级标头 = 访问请求.headers.get('Upgrade');
    const url = new URL(访问请求.url);

    if (!升级标头 || 升级标头 !== 'websocket') {
      // 非 WebSocket 请求处理 (订阅、Hello World)
      if (我的优选TXT) {
        const 链接数组 = Array.isArray(我的优选TXT) ? 我的优选TXT : [我的优选TXT];
        const 所有节点 = [];
        for (const 链接 of 链接数组) {
          try {
            const 响应 = await fetch(链接);
            const 文本 = await 响应.text();
            const 节点 = 文本.split('\n').map(line => line.trim()).filter(line => line);
            所有节点.push(...节点);
          } catch (e) {
            console.warn(`无法获取或解析优选链接: ${链接}`, e);
          }
        }
        if (所有节点.length > 0) 我的优选 = 所有节点;
      }
      switch (url.pathname) {
        case '/': // 处理伪装页面
          return serveDisguisePage(); // 返回伪装页面
        case `/${哎呀呀这是我的ID啊}`: {
          const sub = 给我订阅页面(哎呀呀这是我的ID啊, 访问请求.headers.get('Host'));
          return new Response(sub, {
            status: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" }
          });
        }
        case `/${哎呀呀这是我的ID啊}/${转码}${转码2}`: {
          if (隐藏订阅) {
            return new Response(嘲讽语, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          } else {
            const cfg = 给我通用配置文件(访问请求.headers.get('Host'));
            return new Response(cfg, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          }
        }
        default:
          return new Response('Hello World!', { status: 200 }); // 或其他默认响应
      }
    } else {
      // WebSocket 升级请求处理
      if (私钥开关) {
        const k = 访问请求.headers.get('my-key');
        if (k !== 咦这是我的私钥哎) return new Response('私钥验证失败', { status: 403 });
      }
      const enc = 访问请求.headers.get('sec-websocket-protocol');
      const data = 使用64位加解密(enc);
      if (!私钥开关 && 验证VL的密钥(new Uint8Array(data.slice(1, 17))) !== 哎呀呀这是我的VL密钥) {
        return new Response('无效的UUID', { status: 403 });
      }
      try {
        const { tcpSocket, initialData } = await 解析VL标头(data);
        return await 升级WS请求(访问请求, tcpSocket, initialData);
      } catch (e) {
        console.error("VL 协议解析或 TCP 连接失败:", e);
        return new Response(`Bad Gateway: ${e.message}`, { status: 502 });
      }
    }
  }
};

async function 升级WS请求(访问请求, tcpSocket, initialData) {
  const { 0: 客户端, 1: WS接口 } = new WebSocketPair();
  WS接口.accept();
  建立传输管道(WS接口, tcpSocket, initialData);
  return new Response(null, { status: 101, webSocket: 客户端 });
}

function 使用64位加解密(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(str), c => c.charCodeAt(0)).buffer;
}

async function 解析VL标头(buf) {
  const b = new DataView(buf), c = new Uint8Array(buf);
  const 获取数据定位 = c[17];
  const 提取端口索引 = 18 + 获取数据定位 + 1;
  const 访问端口 = b.getUint16(提取端口索引);
  if (访问端口 === 53) throw new Error('拒绝DNS连接') // 避免直接DNS连接
  const 提取地址索引 = 提取端口索引 + 2;
  let 识别地址类型 = c[提取地址索引];
  let 地址信息索引 = 提取地址索引 + 1;
  let 访问地址;
  let 地址长度;

  switch (识别地址类型) {
    case 1: // IPv4
      地址长度 = 4;
      访问地址 = Array.from(c.slice(地址信息索引, 地址信息索引 + 地址长度)).join('.');
      break;
    case 2: // 域名
      地址长度 = c[地址信息索引];
      地址信息索引 += 1;
      const 访问域名 = new TextDecoder().decode(c.slice(地址信息索引, 地址信息索引 + 地址长度));
      访问地址 = await 查询最快IP(访问域名); // 使用DOH查询IP
      if (访问地址 !== 访问域名) {
        // 更新地址类型，因为 DOH 可能将域名解析为 IPv6
        识别地址类型 = 访问地址.includes(':') ? 3 : 1;
      }
      break;
    case 3: // IPv6
      地址长度 = 16;
      const ipv6 = [];
      const 读取IPV6地址 = new DataView(buf, 地址信息索引, 16);
      for (let i = 0; i < 8; i++) ipv6.push(读取IPV6地址.getUint16(i * 2).toString(16));
      访问地址 = ipv6.join(':');
      break;
    default:
      throw new Error ('无效的访问地址类型');
  }

  const initialData = buf.slice(地址信息索引 + 地址长度);
  let tcpSocket;

  // SOCKS5 逻辑集成
  if (启用SOCKS5反代) { // 检查是否启用 SOCKS5 反代
    if (启用SOCKS5全局反代) { // 全局SOCKS5反代
      tcpSocket = await 尝试创建SOCKS5接口(识别地址类型, 访问地址, 访问端口);
    } else { // 非全局SOCKS5反代，仅当直连失败时尝试SOCKS5
      try {
        tcpSocket = connect({ hostname: 访问地址, port: 访问端口 });
        await tcpSocket.opened;
      } catch (e) {
        console.warn(`直接连接目标 ${访问地址}:${访问端口} 失败，尝试通过SOCKS5代理: ${e.message}`);
        tcpSocket = await 尝试创建SOCKS5接口(识别地址类型, 访问地址, 访问端口);
      }
    }
  } else { // 不启用SOCKS5反代，直接连接
    tcpSocket = connect({ hostname: 访问地址, port: 访问端口 });
  }

  // 确保 socket 已打开，否则会抛出错误
  await tcpSocket.opened;
  return { tcpSocket, initialData };
}

// 改进：尝试创建SOCKS5接口（并发模式，哪个快用哪个，自动跳过失败）
async function 尝试创建SOCKS5接口(识别地址类型, 目标地址, 目标端口) {
  let proxiesToTry = [];

  // 首先，尝试从 SOCKS5地址池 获取代理
  if (SOCKS5地址池.length > 0) {
    proxiesToTry = [...SOCKS5地址池]; // 复制一份，避免修改原数组
  }

  // 如果 SOCKS5地址池 为空，但 我的SOCKS5账号 配置了，则将其作为备用
  if (proxiesToTry.length === 0 && 我的SOCKS5账号) {
    proxiesToTry.push(我的SOCKS5账号);
  }

  if (proxiesToTry.length === 0) {
    throw new Error('未配置任何 SOCKS5 代理地址 (SOCKS5_TXT_URL 或 SOCKS5_ADDRESS)。');
  }

  const connectionPromises = proxiesToTry.map(async (proxyConfig, index) => {
    let tcpSocket = null;
    try {
      const { 账号, 密码, 地址, 端口 } = await 获取SOCKS5账号(proxyConfig);
      console.log(`正在并发尝试连接 SOCKS5 代理: ${账号 ? '带认证' : '无认证'} ${地址}:${端口} (代理 ${index + 1}/${proxiesToTry.length})`);

      // 创建一个带超时的 Promise
      const timeoutPromise = new Promise((resolve, reject) => {
        const id = setTimeout(() => {
          reject(new Error(`连接超时: ${地址}:${端口}`));
        }, SOCKS5_CONNECT_TIMEOUT); // 使用配置的超时时间
      });

      // 竞速连接尝试和超时
      tcpSocket = await Promise.race([
        创建SOCKS5接口连接(账号, 密码, 地址, 端口, 识别地址类型, 目标地址, 目标端口),
        timeoutPromise
      ]);

      console.log(`成功连接 SOCKS5 代理: ${地址}:${端口}`);
      return { socket: tcpSocket, config: proxyConfig }; // 返回成功连接的 socket
    } catch (e) {
      console.warn(`SOCKS5 代理连接失败或超时 (${proxyConfig}): ${e.message}`);
      if (tcpSocket) {
        try { tcpSocket.close(); } catch (closeErr) { console.warn("关闭失败连接时出错:", closeErr); }
      }
      return Promise.reject(new Error(`代理失败: ${proxyConfig} - ${e.message}`)); // 标记为拒绝，让 Promise.any 处理
    }
  });

  try {
    const { socket, config } = await Promise.any(connectionPromises);
    // 当 Promise.any 成功时，意味着至少一个代理连接成功
    // 此时，Promise.any 会自动处理其他仍在进行的 Promise，不成功的会被抛弃
    return socket;
  } catch (aggregateError) {
    // Promise.any 抛出 AggregateError，如果所有 Promise 都失败了
    console.error(`所有 SOCKS5 代理尝试均失败:`, aggregateError.errors.map(e => e.message).join('; '));
    throw new Error('所有 SOCKS5 代理尝试均失败。');
  }
}

// 提取创建SOCKS5接口的核心逻辑到单独函数，方便复用
async function 创建SOCKS5接口连接(账号, 密码, S5地址, S5端口, 识别地址类型, 访问地址, 访问端口) {
  const SOCKS5接口 = connect({ hostname: S5地址, port: S5端口 });
  let 传输数据, 读取数据;
  try {
    await SOCKS5接口.opened;
    传输数据 = SOCKS5接口.writable.getWriter();
    读取数据 = SOCKS5接口.readable.getReader();
    const 转换数组 = new TextEncoder();

    // SOCKS5 认证协商
    // Support no authentication (0x00) and username/password (0x02)
    const 构建S5认证 = new Uint8Array([5, 2, 0, 2]);
    await 传输数据.write(构建S5认证);
    const 读取认证要求 = (await 读取数据.read()).value;

    if (!读取认证要求 || 读取认证要求.length < 2) {
      throw new Error('SOCKS5 认证协商响应无效。');
    }

    if (读取认证要求[1] === 0x02) { // Username/Password authentication required
      if (!账号 || !密码) {
        throw new Error (`SOCKS5 代理需要认证，但未配置账号密码。`);
      }
      const 构建账号密码包 = new Uint8Array([ 1, 账号.length, ...转换数组.encode(账号), 密码.length, ...转换数组.encode(密码) ]);
      await 传输数据.write(构建账号密码包);
      const 读取账号密码认证结果 = (await 读取数据.read()).value;
      if (!读取账号密码认证结果 || 读取账号密码认证结果.length < 2 || 读取账号密码认证结果[0] !== 0x01 || 读取账号密码认证结果[1] !== 0x00) {
        throw new Error (`SOCKS5 账号密码错误或认证失败。`);
      }
    } else if (读取认证要求[1] === 0x00) { // No authentication required
        // Do nothing, proceed to connection
    } else {
        throw new Error (`SOCKS5 认证方式不支持: ${读取认证要求[1]}`);
    }

    // SOCKS5 连接目标
    let 转换访问地址;
    switch (识别地址类型) {
      case 1: // IPv4
        转换访问地址 = new Uint8Array( [1, ...访问地址.split('.').map(Number)] );
        break;
      case 2: // 域名
        转换访问地址 = new Uint8Array( [3, 访问地址.length, ...转换数组.encode(访问地址)] );
        break;
      case 3: // IPv6
        const ipv6Parts = 访问地址.split(':');
        const ipv6Bytes = [];
        let doubleColonHandled = false;
        for (let i = 0; i < ipv6Parts.length; i++) {
          let part = ipv6Parts[i];
          if (part === '') { // Handle ::
            if (!doubleColonHandled) {
              let numMissingParts = 8 - (ipv6Parts.length - 1);
              if (ipv6Parts[0] === '' && i === 0) numMissingParts++; // e.g. ::1
              if (ipv6Parts[ipv6Parts.length - 1] === '' && i === ipv6Parts.length - 1) numMissingParts++; // e.g. 1::

              for (let j = 0; j < numMissingParts; j++) {
                ipv6Bytes.push(0x00, 0x00);
              }
              doubleColonHandled = true;
            }
          } else {
            let val = parseInt(part, 16);
            ipv6Bytes.push((val >> 8) & 0xFF, val & 0xFF);
          }
        }
        // If :: was at the end and no explicit parts followed, ensure 8 parts
        while (ipv6Bytes.length < 16) {
            ipv6Bytes.push(0x00, 0x00);
        }
        转换访问地址 = new Uint8Array( [4, ...ipv6Bytes] );
        break;
      default:
        throw new Error ('无效的SOCKS5目标地址类型');
    }

    const 构建转换后的访问地址 = new Uint8Array([ 5, 1, 0, ...转换访问地址, 访问端口 >> 8, 访问端口 & 0xff ]);
    await 传输数据.write(构建转换后的访问地址);
    const 检查返回响应 = (await 读取数据.read()).value;

    if (!检查返回响应 || 检查返回响应.length < 2 || 检查返回响应[0] !== 0x05 || 检查返回响应[1] !== 0x00) {
      throw new Error (`SOCKS5目标地址连接失败，目标: ${访问地址}:${访问端口}, SOCKS5响应码: ${检查返回响应 ? 检查返回响应[1] : '无响应'}`);
    }

    传输数据.releaseLock();
    读取数据.releaseLock();
    return SOCKS5接口;
  } catch (e) {
    if (传输数据) 传输数据.releaseLock();
    if (读取数据) 读取数据.releaseLock();
    if (SOCKS5接口) SOCKS5接口.close();
    // 抛出错误以便上层 (尝试创建SOCKS5接口) 捕获并跳过
    throw e;
  }
}

async function 建立传输管道(ws, tcp, init) {
  // 发送 VL 握手成功的响应
  ws.send(new Uint8Array([0, 0]));

  const writer = tcp.writable.getWriter();
  const reader = tcp.readable.getReader();

  // 写入 VL 客户端的初始数据
  if (init && init.byteLength > 0) {
    await writer.write(init).catch(err => console.error("写入初始数据到 TCP 失败:", err));
  }

  // WebSocket 到 TCP 的数据传输
  ws.addEventListener('message', async e => {
    if (e.data instanceof ArrayBuffer) {
      try {
        await writer.write(e.data);
      } catch (err) {
        console.error("从 WebSocket 写入 TCP 失败:", err);
        // 如果写入失败，可以考虑关闭 WS，但这里更倾向于让 TCP 的错误处理来结束连接
      }
    } else {
      console.warn("收到非 ArrayBuffer 类型数据 (WebSocket):", e.data);
    }
  });

  // TCP 到 WebSocket 的数据传输
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break; // TCP 连接关闭
      if (value) {
        try {
          ws.send(value);
        } catch (sendErr) {
          console.error("从 TCP 发送数据到 WebSocket 失败:", sendErr);
          break; // 如果 WebSocket 发送失败，停止读取 TCP
        }
      }
    }
  } catch (readErr) {
    console.error("从 TCP 读取数据失败:", readErr);
  } finally {
    // 确保所有资源被关闭
    try { ws.close(); } catch (e) { console.warn("关闭 WebSocket 失败:", e); }
    try { reader.cancel(); } catch (e) { console.warn("取消 TCP 读取器失败:", e); }
    try { writer.releaseLock(); } catch (e) { console.warn("释放 TCP 写入器锁失败:", e); }
    try { tcp.close(); } catch (e) { console.warn("关闭 TCP 连接失败:", e); }
    console.log("传输管道已关闭。");
  }
}

function 验证VL的密钥(a) {
  const hex = Array.from(a, v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function 获取SOCKS5账号(SOCKS5) {
  const 分隔账号 = SOCKS5.lastIndexOf("@");
  if (分隔账号 === -1) { // 如果没有账号密码，则直接是地址:端口
    const [地址, 端口] = 解析地址端口(SOCKS5);
    return { 账号: '', 密码: '', 地址, 端口 };
  }
  const 账号段 = SOCKS5.slice(0, 分隔账号);
  const 地址段 = SOCKS5.slice(分隔账号 + 1);
  const lastColonInAccount = 账号段.lastIndexOf(":");
  const 账号 = lastColonInAccount > -1 ? 账号段.slice(0, lastColonInAccount) : '';
  const 密码 = lastColonInAccount > -1 ? 账号段.slice(lastColonInAccount + 1) : '';
  const [地址, 端口] = 解析地址端口(地址段);
  return { 账号, 密码, 地址, 端口 };
}

function 解析地址端口(地址段) {
  let 地址, 端口;
  if (地址段.startsWith('[')) { // IPv6地址
    const endBracket = 地址段.indexOf(']');
    if (endBracket === -1) throw new Error('无效的 IPv6 地址格式');
    地址 = 地址段.slice(1, endBracket);
    // 检查是否有端口，例如 [::1]:8080
    const portString = 地址段.slice(endBracket + 1);
    端口 = portString.startsWith(':') ? Number(portString.slice(1)) : 443;
    if (isNaN(端口) || 端口 <= 0 || 端口 > 65535) 端口 = 443; // 默认端口
  } else { // IPv4或域名
    const lastColon = 地址段.lastIndexOf(':');
    if (lastColon > -1 && !isNaN(Number(地址段.slice(lastColon + 1)))) {
      地址 = 地址段.slice(0, lastColon);
      端口 = Number(地址段.slice(lastColon + 1));
    } else {
      地址 = 地址段;
      端口 = 443; // 默认端口
    }
  }
  return [地址, 端口];
}

async function 查询最快IP(访问域名) {
  const 构造请求 = (type) =>
    DOH服务器列表.map(DOH =>
      fetch(`${DOH}?name=${访问域名}&type=${type}`, {
        headers: { 'Accept': 'application/dns-json' }
      }).then(res => res.json())
        .then(json => {
          // A 记录 type 1, AAAA 记录 type 28
          const ip = json.Answer?.find(r => r.type === (type === 'A' ? 1 : 28))?.data;
          if (ip) return ip;
          return Promise.reject(`无 ${type} 记录`);
        })
        .catch(err => Promise.reject(`${DOH} ${type} 请求失败: ${err}`))
    );
  try {
    // 优先尝试获取 A 记录 (IPv4)
    return await Promise.any(构造请求('A'));
  } catch (e) {
    // 如果 IPv4 失败，尝试获取 AAAA 记录 (IPv6)
    try {
      return await Promise.any(构造请求('AAAA'));
    } catch (e2) {
      console.warn(`DOH 查询 ${访问域名} 失败 (IPv4 和 IPv6): ${e2.message}`);
      return 访问域名; // 所有 DOH 查询失败，返回原始域名
    }
  }
}

function 给我订阅页面(ID, host) {
  return `
1、本worker的私钥功能只支持通用订阅，其他请关闭私钥功能
2、其他需求自行研究
通用的：https${符号}${host}/${ID}/${转码}${转码2}
`;
}

function 给我通用配置文件(host) {
  // 检查 我的优选 和 我的优选TXT 是否为空或只包含空字符串
  const isMyPreferredEmpty = 我的优选.length === 0 || (我的优选.length === 1 && 我的优选[0] === '');
  const isMyPreferredTxtEmpty = 我的优选TXT.length === 0 || (我的优选TXT.length === 1 && 我的优选TXT[0] === '');

  // 如果 我的优选 和 我的优选TXT 都为空，则使用备用节点信息
  const effectiveMyPreferred = (!isMyPreferredEmpty || !isMyPreferredTxtEmpty) ? 我的优选 : [`${host}:443#备用节点`];

  if (私钥开关) {
    return `请先关闭私钥功能`;
  } else {
    return effectiveMyPreferred.map(item => {
      // 检查 item 是否包含 @ (tls 配置)
      const parts = item.split("@");
      let mainPart = parts[0];
      let tlsOption = 'security=tls'; // 默认启用 TLS

      if (parts.length > 1) {
          // 如果有 @ 符号，则后面的部分可能是 tls 配置
          const tlsConfig = parts[1];
          if (tlsConfig.toLowerCase() === 'notls') {
              tlsOption = 'security=none';
          }
          // 如果还有其他 tls 配置，可以在这里扩展解析
      }

      const [addrPort, name = 我的节点名字] = mainPart.split("#");
      const addrParts = addrPort.split(":");
      const port = addrParts.length > 1 && !isNaN(Number(addrParts[addrParts.length - 1])) ? Number(addrParts.pop()) : 443;
      const addr = addrParts.join(":"); // 重新组合地址，处理 IPv6 带冒号的情况

      return `${转码}${转码2}${符号}${哎呀呀这是我的VL密钥}@${addr}:${port}?encryption=none&${tlsOption}&sni=${host}&type=ws&host=${host}&path=%2F%3Fed%3D2560#${name}`;
    }).join("\n");
  }
		}
