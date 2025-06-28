
let NAT64 = true; // ← 改名：默认开启 

let 我的节点名字 = '天书暴躁版';

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

/* ---------- NAT64 工具 ---------- */
function convertToNAT64IPv6(ipv4) {
  const parts = ipv4.split('.');
  if (parts.length !== 4) throw new Error('无效的IPv4地址');
  const hex = parts.map(p => Number(p).toString(16).padStart(2, '0'));
  return `[2001:67c:2960:6464::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}]`;
}

async function getIPv6ProxyAddress(domain) {
  const r = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=A`, {
    headers: { 'Accept': 'application/dns-json' }
  });
  const j = await r.json();
  const a = j.Answer?.find(x => x.type === 1);
  if (!a) throw new Error('无法解析域名的IPv4地址');
  return convertToNAT64IPv6(a.data);
}

export default {
  async fetch(访问请求, env) {
    哎呀呀这是我的ID啊   = 读取环境变量('ID',        哎呀呀这是我的ID啊, env);
    哎呀呀这是我的VL密钥 = 读取环境变量('UUID',      哎呀呀这是我的VL密钥, env);
    我的优选             = 读取环境变量('IP',        我的优选,         env);
    我的优选TXT          = 读取环境变量('TXT',       我的优选TXT,      env);
    反代IP               = 读取环境变量('PROXYIP',   反代IP,           env);
    咦这是我的私钥哎       = 读取环境变量('私钥',       咦这是我的私钥哎, env);
    隐藏订阅             = 读取环境变量('隐藏',       隐藏订阅,         env);
    私钥开关             = 读取环境变量('私钥开关',   私钥开关,         env);
    嘲讽语               = 读取环境变量('嘲讽语',     嘲讽语,           env);
    启用反代功能         = 读取环境变量('启用反代功能', 启用反代功能, env);
    NAT64               = 读取环境变量('NAT64',      NAT64,           env);   // ← 改名
    我的节点名字           = 读取环境变量('我的节点名字', 我的节点名字,   env);

    const 升级标头 = 访问请求.headers.get('Upgrade');
    const url = new URL(访问请求.url);

    if (!升级标头 || 升级标头 !== 'websocket') {
      /* ---- 订阅/普通响应代码保持原样 ---- */
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
            console.warn(`无法获取或解析链接: ${链接}`, e);
          }
        }
        if (所有节点.length > 0) 我的优选 = 所有节点;
      }
      switch (url.pathname) {
        case `/${哎呀呀这是我的ID啊}`:
          return new Response(给我订阅页面(哎呀呀这是我的ID啊, 访问请求.headers.get('Host')), {
            status: 200, headers: { "Content-Type": "text/plain;charset=utf-8" }
          });
        case `/${哎呀呀这是我的ID啊}/${转码}${转码2}`:
          if (隐藏订阅) {
            return new Response(嘲讽语, { status: 200, headers: { "Content-Type": "text/plain;charset=utf-8" } });
          }
          return new Response(给我通用配置文件(访问请求.headers.get('Host')), {
            status: 200, headers: { "Content-Type": "text/plain;charset=utf-8" }
          });
        default:
          return new Response('Hello World!', { status: 200 });
      }
    } else {
      if (私钥开关) {
        const k = 访问请求.headers.get('my-key');
        if (k !== 咦这是我的私钥哎) return new Response('私钥验证失败', { status: 403 });
      }
      const enc = 访问请求.headers.get('sec-websocket-protocol');
      const data = 使用64位加解密(enc);
      if (验证VL的密钥(new Uint8Array(data.slice(1, 17))) !== 哎呀呀这是我的VL密钥) {
        return new Response('无效的UUID', { status: 403 });
      }
      const { tcpSocket, initialData } = await 解析VL标头(data);
      return await 升级WS请求(访问请求, tcpSocket, initialData);
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
  const addrTypeIndex = c[17];
  const port = b.getUint16(18 + addrTypeIndex + 1);
  let offset = 18 + addrTypeIndex + 4;
  let host;
  if (c[offset - 1] === 1) {
    host = Array.from(c.slice(offset, offset + 4)).join('.');
    offset += 4;
  } else if (c[offset - 1] === 2) {
    const len = c[offset];
    host = new TextDecoder().decode(c.slice(offset + 1, offset + 1 + len));
    offset += len + 1;
  } else {
    const dv = new DataView(buf);
    host = Array(8).fill().map((_, i) => dv.getUint16(offset + 2 * i).toString(16)).join(':');
    offset += 16;
  }
  const initialData = buf.slice(offset);

  /* --------- 1. 直连 --------- */
  try {
    const tcpSocket = await connect({ hostname: host, port });
    await tcpSocket.opened;
    return { tcpSocket, initialData };
  } catch { /* ignore */ }

  /* --------- 2. NAT64 --------- */
  if (NAT64) {
    try {
      let natTarget;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        natTarget = convertToNAT64IPv6(host);
      } else if (host.includes(':')) {
        throw new Error('IPv6 地址无需 NAT64');
      } else {
        natTarget = await getIPv6ProxyAddress(host);
      }
      const natSock = await connect({ hostname: natTarget.replace(/^|$/g, ''), port });
      await natSock.opened;
      return { tcpSocket: natSock, initialData };
    } catch { /* ignore */ }
  }

  /* --------- 3. 反代兜底 --------- */
  if (!启用反代功能 || !反代IP) throw Error('连接失败');
  const [h, p] = 反代IP.split(':');
  const tcpSocket = await connect({ hostname: h, port: Number(p) || port });
  await tcpSocket.opened;
  return { tcpSocket, initialData };
}
