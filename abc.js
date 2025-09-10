// ====================================================================
// 云端响马工头：飞来石客栈的暗号 + SOCKS5 (带同伙SOCKS5代理的选择权)
// --------------------------------------------------------------------

// 云端工头暗号本 (环境变量) 记事：
//   大当家    必填，飞来石客栈客人的暗号
//   二当家    可选，接头路径 (默认 123456)
//   探子窝点  可选，老窝地址 user:pass@127.0.0.1:1080，探子名单失效时用
//   探子名单  可选，暗桩窝点的名单，例如：https://example.com/socks5_list.txt
//   探子限时  = 5000; // 探子接头时间 (毫秒)，可选
//   探子启用  可选，true|false，true用探子反向接头，false直连 (默认 true)
//   探子全员  可选，true|false，true全员用探子，false只在直连失败时用 (默认 true)
//   藏宝图    可选，true|false，true时接头只给一句黑话
//   秘密信物  可选，用于接头暗号的私密信物
//   信物开关  可选，true|false，是否启用私密信物认证
//   黑话      可选，藏宝图时返回的黑话
//
// ====================================================================

import { connect } from 'cloudflare:sockets';

const 客栈暗号 = 'vl';
const 接头后缀 = 'ess';
const 接头口令 = '://';

//////////////////////////////////////////////////////////////////////////匪帮据点规矩////////////////////////////////////////////////////////////////////////
let 匪帮路径 = "123456";
let 匪帮暗号 = "25dce6e6-1c37-4e8c-806b-5ef8affd9f55";

let 启用信物 = false;
let 秘密信物 = "";

let 藏宝图 = false;
let 黑话 = "哎呀你找到了我，但是我就是不给你看，气不气，嘿嘿嘿";

let 优选据点们 = ['cloudflare-ddns.zone.id:443#北美匪帮大寨'];
let 优选据点名单 = [''];

let 我家寨名 = 'SOCKS5版';

// 探子窝点规矩
let 启用探子窝点 = true;
let 探子窝点全员 = true;
let 备用探子窝点 = '';

// 新规矩：探子窝点名单
let 探子窝点名单 = '';

// 探子窝点和上次更新时间
let 探子窝点池 = [];
let 探子上次更新 = 0;
const 探子刷新时辰 = 5 * 60 * 1000; // 5 分钟 (毫秒)
const 探子接头限时 = 5000; // 探子接头超时 (毫秒)

const 探子联络点 = [
  "https://dns.google/dns-query",
  "https://cloudflare-dns.com/dns-query",
  "https://1.1.1.1/dns-query",
  "https://dns.quad9.net/dns-query",
];

// --- 新规矩：乔装打扮和窝点页面 ---
const 乔装窝点 = 'https://cf-worker-dir-bke.pages.dev/';

async function 扮作寻常人家() {
  try {
    const res = await fetch(乔装窝点, { cf: { cacheEverything: true } });
    return new Response(res.body, res);
  } catch {
    return new Response(
      `<!DOCTYPE html>
       <html>
         <head><title>欢迎光临</title></head>
         <body><h1>云端响马工头已在此安寨</h1>
         <p>此页面为静态伪装页面（联络失败）。</p></body>
       </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }
}
// --- 规矩结束 ---

const 摸清环境变量 = (名字, 替补, 巢穴) => {
  const 原始值 = import.meta?.env?.[名字] ?? 巢穴?.[名字];
  if (原始值 === undefined || 原始值 === null || 原始值 === '') return 替补;
  if (typeof 原始值 === 'string') {
    const 修剪值 = 原始值.trim();
    if (修剪值 === 'true') return true;
    if (修剪值 === 'false') return false;
    if (修剪值.includes('\n')) {
      return 修剪值.split('\n').map(item => item.trim()).filter(Boolean);
    }
    if (!isNaN(修剪值) && 修剪值 !== '') return Number(修剪值);
    return 修剪值;
  }
  return 原始值;
};

// 新规矩：加载探子窝点名单
async function 加载探子窝点名单() {
  if (!探子窝点名单) {
    console.log('探子名单未配置，跳过加载。');
    return;
  }

  const 当前时辰 = Date.now();
  if (当前时辰 - 探子上次更新 < 探子刷新时辰 && 探子窝点池.length > 0) {
    return;
  }

  console.log('正在加载探子名单...');
  try {
    const response = await fetch(探子窝点名单);
    if (!response.ok) {
      throw new Error(`加载探子名单失败: ${response.statusText} (状态: ${response.status})`);
    }
    const text = await response.text();
    const 地址们 = text.split('\n')
                           .map(line => line.trim())
                           .filter(line => line && !line.startsWith('#'));

    if (地址们.length > 0) {
      探子窝点池 = 地址们;
      探子上次更新 = 当前时辰;
      console.log(`成功加载 ${探子窝点池.length} 个探子窝点。`);
    } else {
      console.warn('探子名单文件为空或无有效窝点。保留上次成功的名单。');
    }
  } catch (e) {
    console.error(`加载探子名单失败: ${e.message}。将使用备用窝点（如已配置）或上次的成功名单。`);
  }
}

export default {
  async fetch(request, env) {
    // 摸清环境变量
    匪帮路径 = 摸清环境变量('ID', 匪帮路径, env);
    匪帮暗号 = 摸清环境变量('UUID', 匪帮暗号, env);
    优选据点们 = 摸清环境变量('IP', 优选据点们, env);
    优选据点名单 = 摸清环境变量('TXT', 优选据点名单, env);
    秘密信物 = 摸清环境变量('私钥', 秘密信物, env);
    藏宝图 = 摸清环境变量('隐藏', 藏宝图, env);
    启用信物 = 摸清环境变量('私钥开关', 启用信物, env);
    黑话 = 摸清环境变量('嘲讽语', 黑话, env);
    我家寨名 = 摸清环境变量('我的节点名字', 我家寨名, env);

    // 摸清探子窝点环境变量
    启用探子窝点 = 摸清环境变量('SOCKS5_ENABLE', 启用探子窝点, env);
    探子窝点全员 = 摸清环境变量('SOCKS5_GLOBAL', 探子窝点全员, env);
    备用探子窝点 = 摸清环境变量('SOCKS5_ADDRESS', 备用探子窝点, env);
    探子窝点名单 = 摸清环境变量('SOCKS5_TXT_URL', 探子窝点名单, env);

    await 加载探子窝点名单();

    const 升级暗号 = request.headers.get('Upgrade');
    const url = new URL(request.url);

    if (!升级暗号 || 升级暗号 !== 'websocket') {
      // 没对上暗号，处理寻常路人
      if (优选据点名单) {
        const urlArray = Array.isArray(优选据点名单) ? 优选据点名单 : [优选据点名单];
        const 所有据点 = [];
        for (const link of urlArray) {
          try {
            const response = await fetch(link);
            const text = await response.text();
            const 据点们 = text.split('\n').map(line => line.trim()).filter(line => line);
            所有据点.push(...据点们);
          } catch (e) {
            console.warn(`从名单联络据点失败: ${link}`, e);
          }
        }
        if (所有据点.length > 0) 优选据点们 = 所有据点;
      }
      switch (url.pathname) {
        case '/':
          return 扮作寻常人家();
        case `/${匪帮路径}`: {
          const sub = 生成订阅页面(匪帮路径, request.headers.get('Host'));
          return new Response(sub, {
            status: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" }
          });
        }
        case `/${匪帮路径}/${客栈暗号}${接头后缀}`: {
          if (藏宝图) {
            return new Response(黑话, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          } else {
            const config = 生成配置文件(request.headers.get('Host'));
            return new Response(config, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          }
        }
        default:
          return new Response('来者何人!', { status: 200 });
      }
    } else {
      // 对上暗号，处理接头人
      if (启用信物) {
        const k = request.headers.get('my-key');
        if (k !== 秘密信物) return new Response('信物不对，杀！', { status: 403 });
      }
      const 编码 = request.headers.get('sec-websocket-protocol');
      const 数据 = 解码天书(编码);
      if (!启用信物 && 获取匪帮暗号(new Uint8Array(数据.slice(1, 17))) !== 匪帮暗号) {
        return new Response('暗号不对', { status: 403 });
      }
      try {
        const { tcpSocket, 初始数据 } = await 解析匪帮暗号(数据);
        return await 处理接头升级(request, tcpSocket, 初始数据);
      } catch (e) {
        console.error("匪帮暗号解析或接头失败:", e);
        return new Response(`接头失败: ${e.message}`, { status: 502 });
      }
    }
  }
};

async function 处理接头升级(请求, 接头暗号, 初始数据) {
  const { 0: 寻常路人, 1: 接头人 } = new WebSocketPair();
  接头人.accept();
  接通水管(接头人, 接头暗号, 初始数据);
  return new Response(null, { status: 101, webSocket: 寻常路人 });
}

function 解码天书(天书) {
  天书 = 天书.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(天书), c => c.charCodeAt(0)).buffer;
}

async function 解析匪帮暗号(缓存) {
  const 数据视图 = new DataView(缓存), 字节数组 = new Uint8Array(缓存);
  const 数据位置 = 字节数组[17];
  const 端口位置 = 18 + 数据位置 + 1;
  const 目标端口 = 数据视图.getUint16(端口位置);
  if (目标端口 === 53) throw new Error('拒绝DNS联络');
  const 地址位置 = 端口位置 + 2;
  let 地址类型 = 字节数组[地址位置];
  let 地址信息位置 = 地址位置 + 1;
  let 目标地址;
  let 地址长度;

  switch (地址类型) {
    case 1: // IPv4
      地址长度 = 4;
      目标地址 = Array.from(字节数组.slice(地址信息位置, 地址信息位置 + 地址长度)).join('.');
      break;
    case 2: // 域名
      地址长度 = 字节数组[地址信息位置];
      地址信息位置 += 1;
      const 域名 = new TextDecoder().decode(字节数组.slice(地址信息位置, 地址信息位置 + 地址长度));
      目标地址 = await 找到最快的窝点(域名);
      if (目标地址 !== 域名) {
        地址类型 = 目标地址.includes(':') ? 3 : 1;
      }
      break;
    case 3: // IPv6
      地址长度 = 16;
      const ipv6 = [];
      const ipv6视图 = new DataView(缓存, 地址信息位置, 16);
      for (let i = 0; i < 8; i++) ipv6.push(ipv6视图.getUint16(i * 2).toString(16));
      目标地址 = ipv6.join(':');
      break;
    default:
      throw new Error('无效的目标地址类型');
  }

  const 初始数据 = 缓存.slice(地址信息位置 + 地址长度);
  let 接头暗号;

  if (启用探子窝点) {
    if (探子窝点全员) {
      接头暗号 = await 建立探子接头(地址类型, 目标地址, 目标端口);
    } else {
      try {
        接头暗号 = connect({ hostname: 目标地址, port: 目标端口 });
        await 接头暗号.opened;
      } catch (e) {
        console.warn(`直连 ${目标地址}:${目标端口} 失败，尝试探子接头: ${e.message}`);
        接头暗号 = await 建立探子接头(地址类型, 目标地址, 目标端口);
      }
    }
  } else {
    接头暗号 = connect({ hostname: 目标地址, port: 目标端口 });
  }

  await 接头暗号.opened;
  return { tcpSocket: 接头暗号, 初始数据 };
}

async function 建立探子接头(地址类型, 目标地址, 目标端口) {
  let 要试的探子们 = [];

  if (探子窝点池.length > 0) {
    要试的探子们 = [...探子窝点池];
  }

  if (要试的探子们.length === 0 && 备用探子窝点) {
    要试的探子们.push(备用探子窝点);
  }

  if (要试的探子们.length === 0) {
    throw new Error('没有配置探子窝点 (探子名单或探子窝点)。');
  }

  const 接头承诺们 = 要试的探子们.map(async (窝点配置, 索引) => {
    let 接头暗号 = null;
    try {
      const { 匪号, 密码, 窝点, 端口 } = 解析探子地址(窝点配置);
      console.log(`正在尝试与探子接头: ${匪号 ? '带暗号' : '不带暗号'} ${窝点}:${端口} (探子 ${索引 + 1}/${要试的探子们.length})`);

      const 超时承诺 = new Promise((resolve, reject) => {
        const id = setTimeout(() => {
          reject(new Error(`接头超时: ${窝点}:${端口}`));
        }, 探子接头限时);
      });

      接头暗号 = await Promise.race([
        实现探子接头(匪号, 密码, 窝点, 端口, 地址类型, 目标地址, 目标端口),
        超时承诺
      ]);

      console.log(`成功与探子接头: ${窝点}:${端口}`);
      return { socket: 接头暗号, config: 窝点配置 };
    } catch (e) {
      console.warn(`探子接头失败或超时 (${窝点配置}): ${e.message}`);
      if (接头暗号) {
        try { 接头暗号.close(); } catch (关闭错误) { console.warn("关闭失败的接头出错:", 关闭错误); }
      }
      return Promise.reject(new Error(`探子失败: ${窝点配置} - ${e.message}`));
    }
  });

  try {
    const { socket } = await Promise.any(接头承诺们);
    return socket;
  } catch (总错误) {
    console.error(`所有探子接头都失败了:`, 总错误.errors.map(e => e.message).join('; '));
    throw new Error('所有探子接头都失败了。');
  }
}

async function 实现探子接头(匪号, 密码, 窝点, 端口, 地址类型, 目标地址, 目标端口) {
  const 探子窝点 = connect({ hostname: 窝点, port: 端口 });
  let 写入器, 读取器;
  try {
    await 探子窝点.opened;
    写入器 = 探子窝点.writable.getWriter();
    读取器 = 探子窝点.readable.getReader();
    const 编码器 = new TextEncoder();

    // SOCKS5 匪帮规矩
    const 规矩们 = new Uint8Array([5, 2, 0, 2]);
    await 写入器.write(规矩们);
    const 规矩回应 = (await 读取器.read()).value;

    if (!规矩回应 || 规矩回应.length < 2) {
      throw new Error('SOCKS5 匪帮规矩回应不对。');
    }

    if (规矩回应[1] === 0x02) {
      if (!匪号 || !密码) {
        throw new Error(`探子窝点需要暗号，但没配置。`);
      }
      const 认证包裹 = new Uint8Array([1, 匪号.length, ...编码器.encode(匪号), 密码.length, ...编码器.encode(密码)]);
      await 写入器.write(认证包裹);
      const 认证结果 = (await 读取器.read()).value;
      if (!认证结果 || 认证结果.length < 2 || 认证结果[0] !== 0x01 || 认证结果[1] !== 0x00) {
        throw new Error(`SOCKS5 匪号/密码不对或认证失败。`);
      }
    } else if (规矩回应[1] === 0x00) {
      // 不需要暗号
    } else {
      throw new Error(`不支持的 SOCKS5 匪帮规矩: ${规矩回应[1]}`);
    }

    // SOCKS5 接头
    let 目标地址字节们;
    switch (地址类型) {
      case 1: // IPv4
        目标地址字节们 = new Uint8Array([1, ...目标地址.split('.').map(Number)]);
        break;
      case 2: // 域名
        目标地址字节们 = new Uint8Array([3, 目标地址.length, ...编码器.encode(目标地址)]);
        break;
      case 3: // IPv6
        const ipv6部分 = 目标地址.split(':');
        const ipv6字节们 = [];
        let 双冒号已处理 = false;
        for (let i = 0; i < ipv6部分.length; i++) {
          let part = ipv6部分[i];
          if (part === '') {
            if (!双冒号已处理) {
              let 缺失部分 = 8 - (ipv6部分.length - 1);
              if (ipv6部分[0] === '' && i === 0) 缺失部分++;
              if (ipv6部分[ipv6部分.length - 1] === '' && i === ipv6部分.length - 1) 缺失部分++;
              for (let j = 0; j < 缺失部分; j++) {
                ipv6字节们.push(0x00, 0x00);
              }
              双冒号已处理 = true;
            }
          } else {
            let val = parseInt(part, 16);
            ipv6字节们.push((val >> 8) & 0xFF, val & 0xFF);
          }
        }
        while (ipv6字节们.length < 16) {
            ipv6字节们.push(0x00, 0x00);
        }
        目标地址字节们 = new Uint8Array([4, ...ipv6字节们]);
        break;
      default:
        throw new Error('无效的 SOCKS5 目标地址类型');
    }

    const 连接包裹 = new Uint8Array([5, 1, 0, ...目标地址字节们, 目标端口 >> 8, 目标端口 & 0xff]);
    await 写入器.write(连接包裹);
    const 连接回应 = (await 读取器.read()).value;

    if (!连接回应 || 连接回应.length < 2 || 连接回应[0] !== 0x05 || 连接回应[1] !== 0x00) {
      throw new Error(`SOCKS5 目标接头失败。目标: ${目标地址}:${目标端口}, SOCKS5 回应码: ${连接回应 ? 连接回应[1] : '无回应'}`);
    }

    写入器.releaseLock();
    读取器.releaseLock();
    return 探子窝点;
  } catch (e) {
    if (写入器) 写入器.releaseLock();
    if (读取器) 读取器.releaseLock();
    if (探子窝点) 探子窝点.close();
    throw e;
  }
}

async function 接通水管(ws, tcp, 初始数据) {
  // 发送匪帮接头成功的回应
  ws.send(new Uint8Array([0, 0]));

  const 写入器 = tcp.writable.getWriter();
  const 读取器 = tcp.readable.getReader();

  // 写入匪帮客人发来的初始数据
  if (初始数据 && 初始数据.byteLength > 0) {
    await 写入器.write(初始数据).catch(err => console.error("写入初始数据到接头管子失败:", err));
  }

  // 寻常路人到接头管子 (WebSocket to TCP)
  ws.addEventListener('message', async e => {
    if (e.data instanceof ArrayBuffer) {
      try {
        await 写入器.write(e.data);
      } catch (err) {
        console.error("从寻常路人写入到接头管子失败:", err);
      }
    } else {
      console.warn("收到非二进制数据 (寻常路人):", e.data);
    }
  });

  // 接头管子到寻常路人 (TCP to WebSocket)
  try {
    while (true) {
      const { value, done } = await 读取器.read();
      if (done) break;
      if (value) {
        try {
          ws.send(value);
        } catch (发送错误) {
          console.error("从接头管子发送数据到寻常路人失败:", 发送错误);
          break;
        }
      }
    }
  } catch (读取错误) {
    console.error("从接头管子读取数据失败:", 读取错误);
  } finally {
    try { ws.close(); } catch (e) { console.warn("关闭寻常路人失败:", e); }
    try { 读取器.cancel(); } catch (e) { console.warn("取消接头管子读取失败:", e); }
    try { 写入器.releaseLock(); } catch (e) { console.warn("释放接头管子写入锁失败:", e); }
    try { tcp.close(); } catch (e) { console.warn("关闭接头管子失败:", e); }
    console.log("水管接头已关闭。");
  }
}

function 获取匪帮暗号(数组) {
  const hex = Array.from(数组, v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function 找到最快的窝点(域名) {
  const 制造联络请求 = (类型) =>
    探子联络点.map(联络点 =>
      fetch(`${联络点}?name=${域名}&type=${类型}`, {
        headers: { 'Accept': 'application/dns-json' }
      }).then(res => res.json())
        .then(json => {
          const 窝点 = json.Answer?.find(r => r.type === (类型 === 'A' ? 1 : 28))?.data;
          if (窝点) return 窝点;
          return Promise.reject(`没有 ${类型} 记录`);
        })
        .catch(err => Promise.reject(`${联络点} ${类型} 联络失败: ${err}`))
    );
  try {
    return await Promise.any(制造联络请求('A'));
  } catch (e) {
    try {
      return await Promise.any(制造联络请求('AAAA'));
    } catch (e2) {
      console.warn(`联络 ${域名} 失败 (IPv4和IPv6都失败了): ${e2.message}`);
      return 域名;
    }
  }
}

function 解析探子地址(地址字符串) {
  const at索引 = 地址字符串.lastIndexOf("@");
  if (at索引 === -1) {
    const [窝点, 端口] = 解析窝点和端口(地址字符串);
    return { 匪号: '', 密码: '', 窝点, 端口 };
  }
  const 认证部分 = 地址字符串.slice(0, at索引);
  const 窝点部分 = 地址字符串.slice(at索引 + 1);
  const 认证部分的最后一个冒号 = 认证部分.lastIndexOf(":");
  const 匪号 = 认证部分的最后一个冒号 > -1 ? 认证部分.slice(0, 认证部分的最后一个冒号) : '';
  const 密码 = 认证部分的最后一个冒号 > -1 ? 认证部分.slice(认证部分的最后一个冒号 + 1) : '';
  const [窝点, 端口] = 解析窝点和端口(窝点部分);
  return { 匪号, 密码, 窝点, 端口 };
}

function 解析窝点和端口(窝点部分) {
  let 窝点, 端口;
  if (窝点部分.startsWith('[')) {
    const 结束括号 = 窝点部分.indexOf(']');
    if (结束括号 === -1) throw new Error('无效的IPv6地址格式');
    窝点 = 窝点部分.slice(1, 结束括号);
    const 端口字符串 = 窝点部分.slice(结束括号 + 1);
    端口 = 端口字符串.startsWith(':') ? Number(端口字符串.slice(1)) : 443;
    if (isNaN(端口) || 端口 <= 0 || 端口 > 65535) 端口 = 443;
  } else {
    const 最后一个冒号 = 窝点部分.lastIndexOf(':');
    if (最后一个冒号 > -1 && !isNaN(Number(窝点部分.slice(最后一个冒号 + 1)))) {
      窝点 = 窝点部分.slice(0, 最后一个冒号);
      端口 = Number(窝点部分.slice(最后一个冒号 + 1));
    } else {
      窝点 = 窝点部分;
      端口 = 443;
    }
  }
  return [窝点, 端口];
}

function 生成订阅页面(id, host) {
  return `
1、本worker的私钥功能只支持通用订阅，其他请关闭私钥功能
2、其他需求自行研究
通用的：https${接头口令}${host}/${id}/${客栈暗号}${接头后缀}
`;
}

function 生成配置文件(host) {
  const 我优选的为空 = 优选据点们.length === 0 || (优选据点们.length === 1 && 优选据点们[0] === '');
  const 我优选的TXT为空 = 优选据点名单.length === 0 || (优选据点名单.length === 1 && 优选据点名单[0] === '');
  const 有用的优选据点们 = (!我优选的为空 || !我优选的TXT为空) ? 优选据点们 : [`${host}:443#备用节点`];

  if (启用信物) {
    return `请先关闭私钥功能`;
  } else {
    return 有用的优选据点们.map(item => {
      const parts = item.split("@");
      let mainPart = parts[0];
      let tlsOption = 'security=tls';

      if (parts.length > 1) {
          const tlsConfig = parts[1];
          if (tlsConfig.toLowerCase() === 'notls') {
              tlsOption = 'security=none';
          }
      }

      const [addrPort, name = 我家寨名] = mainPart.split("#");
      const addrParts = addrPort.split(":");
      const port = addrParts.length > 1 && !isNaN(Number(addrParts[addrParts.length - 1])) ? Number(addrParts.pop()) : 443;
      const addr = addrParts.join(":");

      return `${客栈暗号}${接头后缀}${接头口令}${匪帮暗号}@${addr}:${port}?encryption=none&${tlsOption}&sni=${host}&type=ws&host=${host}&path=%2F%3Ded%3D2560#${name}`;
    }).join("\n");
  }
	  }
