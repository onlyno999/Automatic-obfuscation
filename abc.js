import { connect as 接続ソケット } from 'cloudflare:sockets';

let 身份識別子 = "bee9ac63-20ea-4b0b-876a-09831e5f755a";
const 備用代理中継 = "wok.woxxxxxx.nyc.mn"; 
const 予備代理経路 = ""; 
const 全局強制中継 = ""; 

const 購読情報源 = [
  "https://bestcf.pages.dev/wetest/ipv4.txt",
  "https://raw.githubusercontent.com/Senflare/Senflare-IP/refs/heads/main/Senflare-Pro.txt"
];

const 人工知能領域名簿 = [
  'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com',
  'anthropic.com', 'claude.ai', 'gemini.google.com', 'generativelanguage.googleapis.com',
  'ai.google.dev', 'x.ai', 'grok.com', 'copilot.microsoft.com',
  'sydney.bing.com', 'perplexity.ai', 'poe.com'
];

function 判定AI領域(領域名) {
  if (!領域名 || typeof 領域名 !== 'string') return false;
  const 小文字名 = 領域名.toLowerCase();
  return 人工知能領域名簿.some(標識 => 小文字名.includes(標識));
}

async function 解析第六版網絡位址(ドメイン) {
  if (!ドメイン || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ドメイン) || ドメイン.includes(':')) return ドメイン;
  try {
    const 応答 = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(ドメイン)}&type=AAAA`, {
      headers: { 'accept': 'application/dns-json' },
      cf: { cacheTtl: 300 }
    });
    if (!応答.ok) return ドメイン;
    const 結果 = await 応答.json();
    const 記録 = 結果.Answer?.filter(項目 => 項目.type === 28);
    if (記録 && 記録.length > 0) {
      const 肆選 = 記録[Math.floor(Math.random() * 記録.length)].data;
      return 肆選.startsWith('[') ? 肆選 : `[${肆選}]`;
    }
  } catch (過失) {}
  return ドメイン;
}

async function 生成訂閲構成(ホスト) {
  const 節点配列 = [];
  const 取得約束 = 購読情報源.map(async (資源位置) => {
    try {
      const 応答 = await fetch(資源位置, { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 600 } });
      if (応答.ok) {
        const 本文 = await 応答.text();
        const 行一覧 = 本文.split(/\r?\n/);
        for (const 単行 of 行一覧) {
          const 整理行 = 単行.trim();
          if (!整理行 || 整理行.startsWith('#')) continue;
          const 断片 = 整理行.split('#');
          const 位置部 = 断片[0].trim();
          const 識別札 = 断片[1] ? 断片[1].trim() : '優選節点';
          let 標的IP = 位置部, 出口ポート = 443;
          if (位置部.includes(':')) {
            const [仮IP, 仮ポート] = 位置部.split(':');
            標的IP = 仮IP;
            出口ポート = parseInt(仮ポート) || 443;
          }
          if (標的IP) 節点配列.push({ ip: 標的IP, port: 出口ポート, tag: 識別札 });
        }
      }
    } catch (例外) {}
  });

  await Promise.all(取得約束);

  const 唯一節点 = [];
  const 既読鍵 = new Set();
  for (const 項目 of 節点配列) {
    const 識別子 = `${項目.ip}:${項目.port}`;
    if (!既読鍵.has(識別子)) {
      既読鍵.add(識別子);
      唯一節点.push(項目);
    }
  }

  if (唯一節点.length === 0) 唯一節点.push({ ip: ホスト, port: 443, tag: '預設節点' });

  const 接続配列 = 唯一節点.map(({ ip: 節点IP, port: 通信口, tag: 銘柄 }) => {
    const 註釈 = encodeURIComponent(`${銘柄}-${節点IP}`);
    return `vless://${身份識別子}@${節点IP}:${通信口}?encryption=none&security=tls&sni=${ホスト}&fp=chrome&type=ws&host=${ホスト}&path=%2F#${註釈}`;
  });

  const 統合テキスト = 接続配列.join('\n');
  return btoa(unescape(encodeURIComponent(統合テキスト)));
}

const 最大保留容量 = 2 * 1024 * 1024, 保活周期 = 15000, 停滞判定閾値 = 8000, 最大停滞計数 = 12, 最大再接続回数 = 24;
const 構築識別コード = (配列, 指針) => Array.from(配列.slice(指針, 指針 + 16)).map(数値 => 数値.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

export default {
  async fetch(請求, 環境変数) {
    const 位址 = new URL(請求.url);

    if (位址.pathname === '/sub' || 位址.pathname === '/auto' || 位址.searchParams.get('token') === 身份識別子) {
      const 構成体 = await 生成訂閲構成(位址.host);
      return new Response(構成体, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Subscription-Userinfo': 'upload=0; download=0; total=1073741824000000; expire=0'
        }
      });
    }

    if (請求.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(`VLESS Node is running.\nSubscription URL: https://${位址.host}/sub`, { 
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const { proxyIP: 備用IP設定, socks5: 代理設定, enableSocks: 代理種別, globalProxy: 全局代理設定 } = 解析代理設定(位址.pathname);
    const 初期通信頭 = 請求.headers.get('sec-websocket-protocol') || '';
    let 先行受領データ = null;

    if (初期通信頭) {
      try {
        const 換装文字列 = 初期通信頭.replace(/-/g, '+').replace(/_/g, '/');
        const 二進文字列 = atob(換装文字列);
        先行受領データ = Uint8Array.from(二進文字列, 文字 => 文字.charCodeAt(0));
      } catch (異常) {}
    }

    const { 0: 端末ソケット, 1: 役務ソケット } = new WebSocketPair();
    役務ソケット.accept();
    
    執行通信処理(役務ソケット, 備用IP設定, 代理設定, 代理種別, 全局代理設定, 先行受領データ);
    
    const 応答頭部 = new Headers();
    if (初期通信頭) 応答頭部.set('Sec-WebSocket-Protocol', 初期通信頭);

    return new Response(null, { status: 101, webSocket: 端末ソケット, headers: 応答頭部 });
  }
};

const 抽出標的情報 = 受信塊 => {
  const 基底 = 18 + 受信塊[17] + 1, 通信口 = (受信塊[基底] << 8) | 受信塊[基底 + 1], 区分 = 受信塊[基底 + 2];
  let 偏移 = 基底 + 3, 主機名, 長さ;
  switch (区分) {
    case 1: 長さ = 4; 主機名 = 受信塊.slice(偏移, 偏移 + 長さ).join('.'); break;
    case 2: 長さ = 受信塊[偏移++]; 主機名 = new TextDecoder().decode(受信塊.slice(偏移, 偏移 + 長さ)); break;
    case 3: 長さ = 16; 主機名 = `[${Array.from({ length: 8 }, (_, 目) => ((受信塊[偏移 + 目 * 2] << 8) | 受信塊[偏移 + 目 * 2 + 1]).toString(16)).join(':')}]`; break;
    default: throw new Error('Invalid address type.');
  } return { host: 主機名, port: 通信口, payload: 受信塊.slice(偏移 + 長さ), addressType: 区分 };
};

const 分離位址端口 = (文字片) => {
  if (文字片.startsWith("[")) {
    const 一致 = 文字片.match(/^\[(.+?)\]:(\d+)$/);
    if (一致) return [一致[1], Number(一致[2])];
    return [文字片.slice(1, -1), 443];
  }
  const [所在, 接続口 = 443] = 文字片.split(":");
  return [所在, Number(接続口)];
};

const 分析代理位址 = (原本文字列) => {
  let 帳號名, 暗号鍵, 主機名, 通信ポート;
  const 抽出文字 = 原本文字列.replace(/^(socks5?|https?):\/\//i, '');

  if (抽出文字.includes('://')) {
    const 解析URL = new URL(原本文字列);
    主機名 = 解析URL.hostname;
    通信ポート = 解析URL.port || (解析URL.protocol === 'http:' ? 80 : 1080);
    const 認証文字列 = 解析URL.username || 解析URL.password ? `${解析URL.username}:${解析URL.password}` : 解析URL.username;
    if (認証文字列 && 認証文字列.includes(':')) [帳號名, 暗号鍵] = 認証文字列.split(':');
  } else {
    let 資格部 = '', 接続部 = 抽出文字;
    const 区切位置 = 抽出文字.lastIndexOf('@');
    if (区切位置 !== -1) { 資格部 = 抽出文字.substring(0, 区切位置); 接続部 = 抽出文字.substring(区切位置 + 1); }

    if (資格部 && !資格部.includes(':')) {
      try { 
        const 復号 = atob(資格部.replace(/%3D/g, '=').padEnd(資格部.length + (4 - 資格部.length % 4) % 4, '=')); 
        const 照合 = 復号.split(':'); if (照合.length === 2) [帳號名, 暗号鍵] = 照合; 
      } catch {}
    }
    if (!帳號名 && 資格部 && 資格部.includes(':')) [帳號名, 暗号鍵] = 資格部.split(':');

    const [確定主機, 確定ポート] = 分離位址端口(接続部);
    主機名 = 確定主機; 通信ポート = 確定ポート || 1080;
  }

  if (!主機名 || isNaN(通信ポート)) throw new Error("Invalid proxy config");
  return { username: 帳號名, password: 暗号鍵, hostname: 主機名, port: 通信ポート };
};

async function 確立SOCKS5接続(区分, 標的所在, 標的ポート, 構成情報) {
  const { username: 使用者, password: 秘匿鍵, hostname: 遠隔主機, port: 接続口 } = 構成情報;
  const 通信線 = 接続ソケット({ hostname: 遠隔主機, port: 接続口 });
  const 書込機 = 通信線.writable.getWriter();
  await 書込機.write(new Uint8Array([5, 使用者 ? 2 : 1, 0, 使用者 ? 2 : 0]));
  const 読取機 = 通信線.readable.getReader();
  const 文字変換 = new TextEncoder();
  let 返答 = (await 読取機.read()).value;
  if (返答[1] === 2) {
    const 認証束 = new Uint8Array([1, 使用者.length, ...文字変換.encode(使用者), 秘匿鍵.length, ...文字変換.encode(秘匿鍵)]);
    await 書込機.write(認証束);
    返答 = (await 読取機.read()).value;
    if (返答[1] !== 0) throw new Error("SOCKS5 auth failed");
  }
  let 宛先配列;
  if (区分 === 1) 宛先配列 = new Uint8Array([1, ...標的所在.split(".").map(Number)]);
  else if (区分 === 2) 宛先配列 = new Uint8Array([3, 標的所在.length, ...文字変換.encode(標的所在)]);
  else if (区分 === 3) {
    const 整理IPv6 = 標的所在.replace(/^\[\vert{}\]$/g, '');
    const 八相値 = 整理IPv6.split(':').flatMap(要素 => [parseInt(要素.slice(0, 2), 16), parseInt(要素.slice(2, 4), 16)]);
    宛先配列 = new Uint8Array([4, ...八相値]);
  }
  await 書込機.write(new Uint8Array([5, 1, 0, ...宛先配列, (標的ポート >> 8) & 0xff, 標的ポート & 0xff]));
  返答 = (await 読取機.read()).value;
  if (返答[1] !== 0) throw new Error("SOCKS5 connect failed");
  書込機.releaseLock(); 読取機.releaseLock();
  return 通信線;
}

async function 確立HTTP接続(区分, 標的所在, 標的ポート, 構成情報) {
  const { username: 利用者, password: 合言葉, hostname: 対象主機, port: 対象口 } = 構成情報;
  const 接続管 = 接続ソケット({ hostname: 対象主機, port: 対象口 });

  let 要求電文 = `CONNECT ${標的所在}:${標的ポート} HTTP/1.1\r\n` +
                 `Host: ${標的所在}:${標的ポート}\r\n`;

  if (利用者 && 合言葉) {
    要求電文 += `Proxy-Authorization: Basic ${btoa(`${利用者}:${合言葉}`)}\r\n`;
  }

  要求電文 += `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36\r\n` +
              `Connection: keep-alive\r\n\r\n`;

  const 筆記者 = 接続管.writable.getWriter();
  await 筆記者.write(new TextEncoder().encode(要求電文));
  筆記者.releaseLock();

  const 読取役 = 接続管.readable.getReader();
  let 一時蓄積 = new Uint8Array(0);

  while (true) {
    const { value: 読取値, done: 完了旗 } = await 読取役.read();
    if (完了旗) throw new Error("HTTP proxy closed unexpectedly");

    const 結合域 = new Uint8Array(一時蓄積.length + 読取値.length);
    結合域.set(一時蓄積);
    結合域.set(読取値, 一時蓄積.length);
    一時蓄積 = 結合域;
    if (一時蓄積.length > 65536) throw new Error("HTTP proxy response too large"); 
    const 復元文 = new TextDecoder().decode(一時蓄積);
    if (復元文.includes("\r\n\r\n")) {
      if (/^HTTP\/1\.[01] 2/i.test(復元文.split("\r\n")[0])) {
        読取役.releaseLock();
        return 接続管;
      }
      throw new Error(`HTTP proxy refused: ${復元文.split("\r\n")[0]}`);
    }
  }
}

function 解析代理設定(経路文字) {
  let proxyIP = null, socks5 = null, enableSocks = null, globalProxy = null;

  const 全局整合 = 経路文字.match(/^\/SOCKS5(?:[:=]|\/\/)?([^/#?]+)/i);
  if (全局整合) {
    const 設定値 = 分析代理位址(全局整合[1]);
    globalProxy = { type: 'socks5', cfg: 設定値 };
    return { proxyIP, socks5, enableSocks, globalProxy };
  } else if (全局強制中継) {
    const 既定全局整合 = 全局強制中継.match(/(socks5?|https?):\/\/(.+)/i);
    if (既定全局整合) {
      const 設定値 = 分析代理位址(既定全局整合[2]);
      globalProxy = { type: 'socks5', cfg: 設定値 };
      return { proxyIP, socks5, enableSocks, globalProxy };
    }
  }

  const 備用IP整合 = 経路文字.match(/^\/ProxyIP[=\/]([^?#]+)/i);
  if (備用IP整合) {
    const 分割片 = 備用IP整合[1];
    if (分割片.includes('@') || 分割片.includes('socks')) {
      socks5 = 分析代理位址(分割片);
      enableSocks = 'socks5';
    } else {
      const [位址部, 通信口 = 443] = 分離位址端口(分割片);
      proxyIP = { address: 位址部.includes('[') ? 位址部.slice(1, -1) : 位址部, port: +通信口 };
    }
  } else {
    if (予備代理経路) {
      socks5 = 分析代理位址(予備代理経路);
      enableSocks = 'socks5';
    }
    if (備用代理中継) {
      const [位址部, 通信口 = 443] = 分離位址端口(備用代理中継);
      proxyIP = { address: 位址部.includes('[') ? 位址部.slice(1, -1) : 位址部, port: +通信口 };
    }
  }

  return { proxyIP, socks5, enableSocks, globalProxy };
}

class 内存蓄積池 {
  constructor() { this.主領域 = new ArrayBuffer(16384); this.指針位置 = 0; this.待機配列 = []; this.上限数 = 8; this.広域有効 = false; }
  alloc = 要求幅 => {
    if (要求幅 <= 4096 && 要求幅 <= 16384 - this.指針位置) { 
      const 確保域 = new Uint8Array(this.主領域, this.指針位置, 要求幅); 
      this.指針位置 += 要求幅; 
      return 確保域; 
    } 
    const 回収物 = this.待機配列.pop();
    if (回収物 && 回収物.byteLength >= 要求幅) return new Uint8Array(回収物.buffer, 0, 要求幅); 
    return new Uint8Array(要求幅);
  };
  free = 解放対象 => {
    if (解放対象.buffer === this.主領域) { this.指針位置 = Math.max(0, this.指針位置 - 解放対象.length); return; }
    if (this.待機配列.length < this.上限数 && 解放対象.byteLength >= 1024) this.待機配列.push(解放対象);
  }; 
  enableLarge = () => { this.広域有効 = true; }; 
  reset = () => { this.指針位置 = 0; this.待機配列.length = 0; this.広域有効 = false; };
}

const 執行通信処理 = (ソケット, 備用IP設定, 代理設定, 代理種別, 全局代理設定, 先行受領データ) => {
  const メモリ資源 = new 内存蓄積池(); 
  let 遠隔線, 出力筆, 入力読, 接続情報, 初回受信旗 = true, 受信バイト累計 = 0, 停滞度 = 0, 再試行回数 = 0;
  let 最終活動刻 = Date.now(), 接続中旗 = false, 読取中旗 = false; 
  const 時限タイマー = {}, 保留キュー = [];
  let 保留総量 = 0, 採点評価 = 1.0, 最終診断刻 = Date.now(), 前回受信量 = 0, 成功度 = 0, 失敗度 = 0;
  let 統計情報 = { tot: 0, cnt: 0, big: 0, win: 0, ts: Date.now() }; 
  let 動作様式 = 'adaptive', 平均容量 = 0, 伝送履歴 = [];

  const 様式更新 = 転送幅 => {
    統計情報.tot += 転送幅; 統計情報.cnt++; if (転送幅 > 8192) 統計情報.big++; 
    平均容量 = 平均容量 * 0.9 + 転送幅 * 0.1; const 現在時 = Date.now();
    if (現在時 - 統計情報.ts > 1000) {
      const 転送比率 = 統計情報.win; 伝送履歴.push(転送比率); if (伝送履歴.length > 5) 伝送履歴.shift(); 
      統計情報.win = 転送幅; 統計情報.ts = 現在時;
      const 移動平均 = 伝送履歴.reduce((累計, 任意項) => 累計 + 任意項, 0) / 伝送履歴.length;
      if (統計情報.cnt >= 20) {
        if (移動平均 < 8388608 || 平均容量 < 4096) { if (動作様式 !== 'buffered') { 動作様式 = 'buffered'; メモリ資源.enableLarge(); } }
        else if (移動平均 > 16777216 && 平均容量 > 12288) { if (動作様式 !== 'direct') 動作様式 = 'direct'; }
        else { if (動作様式 !== 'adaptive') 動作様式 = 'adaptive'; }
      }} else { 統計情報.win += 転送幅; }
  };

  const 循環読取 = async () => {
    if (読取中旗) return; 読取中旗 = true; 
    let 一括箱 = [], 一括容量 = 0, 排出遅延 = null;
    const 一括排出 = () => {
      if (!一括容量) return; 
      const 統合塊 = new Uint8Array(一括容量); let 書出指針 = 0;
      for (const 断片 of 一括箱) { 統合塊.set(断片, 書出指針); 書出指針 += 断片.length; }
      if (ソケット.readyState === 1) ソケット.send(統合塊);
      一括箱 = []; 一括容量 = 0; if (排出遅延) { clearTimeout(排出遅延); 排出遅延 = null; }
    };
    try {
      while (true) {
        if (保留総量 > 最大保留容量) { await new Promise(解決 => setTimeout(解決, 100)); continue; }
        const { done: 読取終端, value: 受領塊 } = await 入力読.read();
        if (受領塊?.length) {
          受信バイト累計 += 受領塊.length; 最終活動刻 = Date.now(); 停滞度 = 0; 様式更新(受領塊.length); 
          const 検査刻 = Date.now();
          if (検査刻 - 最終診断刻 > 5000) {
            const 経過幅 = 検査刻 - 最終診断刻, 差分量 = 受信バイト累計 - 前回受信量, 速度 = 差分量 / 経過幅;
            if (速度 > 500) 採点評価 = Math.min(1.0, 採点評価 + 0.05);
            else if (速度 < 50) 採点評価 = Math.max(0.1, 採点評価 - 0.05);
            最終診断刻 = 検査刻; 前回受信量 = 受信バイト累計;
          }
          if (動作様式 === 'buffered') {
            if (受領塊.length < 16384) {
              一括箱.push(受領塊); 一括容量 += 受領塊.length;
              if (一括容量 >= 65536) 一括排出();
              else if (!排出遅延) 排出遅延 = setTimeout(一括排出, 平均容量 > 8192 ? 8 : 25);
            } else { 一括排出(); if (ソケット.readyState === 1) ソケット.send(受領塊); }
          } else if (動作様式 === 'direct') { 一括排出(); if (ソケット.readyState === 1) ソケット.send(受領塊);
          } else if (動作様式 === 'adaptive') {
            if (受領塊.length < 8192) {
              一括箱.push(受領塊); 一括容量 += 受領塊.length;
              if (一括容量 >= 49152) 一括排出();
              else if (!排出遅延) 排出遅延 = setTimeout(一括排出, 12);
            } else { 一括排出(); if (ソケット.readyState === 1) ソケット.send(受領塊); } }
        } if (読取終端) { 一括排出(); 読取中旗 = false; 再接続処理(); break; }
      }} catch (崩壊) { 一括排出(); if (排出遅延) clearTimeout(排出遅延); 読取中旗 = false; 失敗度++; 再接続処理(); }
  };

  const 試行接続 = async (標的主機, 接続ポート, 種別番号) => {
    if (全局代理設定) {
      if (全局代理設定.type === 'socks5')
        return await 確立SOCKS5接続(種別番号, 標的主機, 接続ポート, 全局代理設定.cfg);
      if (全局代理設定.type === 'http')
        return await 確立HTTP接続(種別番号, 標的主機, 接続ポート, 全局代理設定.cfg);
    } 

    let 確定対象 = 標的主機;
    if (種別番号 === 2 && 判定AI領域(標的主機)) {
      確定対象 = await 解析第六版網絡位址(標的主機);
    }

    try {
      const 直結線 = 接続ソケット({ hostname: 確定対象, port: 接続ポート });
      if (直結線.opened) await 直結線.opened;
      return 直結線;
    } catch (不通) {
      if (!代理設定 && !備用IP設定) throw 不通;

      if (代理設定) {
        try {
          const 補助線 = 代理種別 === 'http'
            ? await 確立HTTP接続(種別番号, 標的主機, 接続ポート, 代理設定)
            : await 確立SOCKS5接続(種別番号, 標的主機, 接続ポート, 代理設定);
          if (補助線.opened) await 補助線.opened;
          return 補助線;
        } catch {}
      }

      if (備用IP設定) {
        try {
          const 予備線 = 接続ソケット({ hostname: 備用IP設定.address, port: 備用IP設定.port });
          if (予備線.opened) await 予備線.opened;
          return 予備線;
        } catch {}
      }

      throw 不通; 
    }
  };

  const 処理初段電文 = (データ列) => {
    if (構築識別コード(データ列, 1) !== 身份識別子) throw new Error('Auth failed');
    const { host: 相手主機, port: 相手ポート, payload: 積載内容, addressType: 種別番号 } = 抽出標的情報(データ列);
    接続情報 = { host: 相手主機, port: 相手ポート, addressType: 種別番号 };
    ソケット.send(new Uint8Array([データ列[0], 0]));
    接続中旗 = true;
    if (積載内容.length) {
      const 確保域 = メモリ資源.alloc(積載内容.length); 確保域.set(積載内容);
      保留キュー.push(確保域); 保留総量 += 確保域.length;
    }
    開始時限監視();
    確立回線();
  };

  const 確立回線 = async () => {
    try {
      遠隔線 = await 試行接続(接続情報.host, 接続情報.port, 接続情報.addressType);
      if (遠隔線.opened) await 遠隔線.opened;
      出力筆 = 遠隔線.writable.getWriter();
      入力読 = 遠隔線.readable.getReader();

      const 先頭集積 = 保留キュー.splice(0, 10);
      for (const 単体 of 先頭集積) { await 出力筆.write(単体); 保留総量 -= 単体.length; メモリ資源.free(単体); }
      接続中旗 = false; 再試行回数 = 0; 採点評価 = Math.min(1.0, 採点評価 + 0.15); 成功度++; 最終活動刻 = Date.now(); 循環読取();
    } catch (破綻) { 接続中旗 = false; 失敗度++; 採点評価 = Math.max(0.1, 採点評価 - 0.2); 再接続処理(); }
  };

  const 再接続処理 = async () => {
    if (!接続情報 || ソケット.readyState !== 1) { 資源破棄(); ソケット.close(1011, 'Invalid.'); return; }
    if (再試行回数 >= 最大再接続回数) { 資源破棄(); ソケット.close(1011, 'Max reconnect.'); return; }
    if (採点評価 < 0.3 && 再試行回数 > 5 && Math.random() > 0.6) { 資源破棄(); ソケット.close(1011, 'Poor network.'); return; }
    if (接続中旗) return; 再試行回数++; 
    let 待機間隔 = Math.min(50 * Math.pow(1.5, 再試行回数 - 1), 3000);
    待機間隔 *= (1.5 - 採点評価 * 0.5); 待機間隔 += (Math.random() - 0.5) * 待機間隔 * 0.2; 待機間隔 = Math.max(50, Math.floor(待機間隔));
    try {
      切断清掃();
      if (保留総量 > 最大保留容量 * 2) {
        while (保留総量 > 最大保留容量 && 保留キュー.length > 5) { const 廃棄片 = 保留キュー.shift(); 保留総量 -= 廃棄片.length; メモリ資源.free(廃棄片); }
      }
      await new Promise(解決 => setTimeout(解決, 待機間隔)); 接続中旗 = true;
      遠隔線 = await 試行接続(接続情報.host, 接続情報.port, 接続情報.addressType); 
      出力筆 = 遠隔線.writable.getWriter(); 入力読 = 遠隔線.readable.getReader(); const 先頭集積 = 保留キュー.splice(0, 10);
      for (const 単体 of 先頭集積) { await 出力筆.write(単体); 保留総量 -= 単体.length; メモリ資源.free(単体); }
      接続中旗 = false; 再試行回数 = 0; 採点評価 = Math.min(1.0, 採点評価 + 0.15); 成功度++; 停滞度 = 0; 最終活動刻 = Date.now(); 循環読取();
    } catch (過失) { 接続中旗 = false; 失敗度++; 採点評価 = Math.max(0.1, 採点評価 - 0.2);
      if (再試行回数 < 最大再接続回数 && ソケット.readyState === 1) setTimeout(再接続処理, 500);
      else { 資源破棄(); ソケット.close(1011, 'Exhausted.'); }}
  };

  const 開始時限監視 = () => {
    時限タイマー.ka = setInterval(async () => {
      if (!接続中旗 && 出力筆 && Date.now() - 最終活動刻 > 保活周期) { try { await 出力筆.write(new Uint8Array(0)); 最終活動刻 = Date.now(); } catch (停止) { 再接続処理(); }}
    }, 保活周期 / 3);
    時限タイマー.hc = setInterval(() => {
      if (!接続中旗 && 統計情報.tot > 0 && Date.now() - 最終活動刻 > 停滞判定閾値) { 停滞度++;
        if (停滞度 >= 最大停滞計数) {
          if (再試行回数 < 最大再接続回数) { 停滞度 = 0; 再接続処理(); }
          else { 資源破棄(); ソケット.close(1011, 'Stall.'); }
        }}}, 停滞判定閾値 / 2);
  };

  const 切断清掃 = () => { 読取中旗 = false; try { 出力筆?.releaseLock(); 入力読?.releaseLock(); 遠隔線?.close(); } catch {} };
  const 資源破棄 = (終了符号, 理由文) => {
    Object.values(時限タイマー).forEach(clearInterval); 切断清掃();
    while (保留キュー.length) メモリ資源.free(保留キュー.shift());
    保留総量 = 0; 統計情報 = { tot: 0, cnt: 0, big: 0, win: 0, ts: Date.now() };
    動作様式 = 'adaptive'; 平均容量 = 0; 伝送履歴 = []; メモリ資源.reset();
    if (ソケット.readyState === 1) ソケット.close(終了符号, 理由文);
  };

  if (先行受領データ) {
    初回受信旗 = false;
    try {
      処理初段電文(先行受領データ);
    } catch (破損) {
      資源破棄();
      ソケット.close(1006, 'Error.');
      return;
    }
  }

  ソケット.addEventListener('message', async 受信事象 => {
    try {
      if (初回受信旗) {
        初回受信旗 = false;
        処理初段電文(new Uint8Array(受信事象.data));
      } else { 
        最終活動刻 = Date.now();
        if (接続中旗 || !出力筆) { const 確保域 = メモリ資源.alloc(受信事象.data.byteLength); 確保域.set(new Uint8Array(受信事象.data)); 保留キュー.push(確保域); 保留総量 += 確保域.length; }
        else { await 出力筆.write(受信事象.data); }
      }
    } catch (突発) { 資源破棄(); ソケット.close(1006, 'Error.'); }
  });
  ソケット.addEventListener('close', 資源破棄);
  ソケット.addEventListener('error', 資源破棄);
};
