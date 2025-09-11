// ====================================================================
// عامل Cloudflare: VL عبر WebSocket + SOCKS5 (مع اختيار وكلاء SOCKS5 متوازيين)
// --------------------------------------------------------------------

// إعدادات عامل Cloudflare (متغيرات البيئة) تُقرأ أولاً،
// ثم من القيم الافتراضية المحددة في هذا النص.
//
// ر.ح.الأساسي: مطلوب، رمز UUID لمستخدم VL.
// ر.ح.الثانوي: اختياري، مسار الاشتراك (الافتراضي 123456).
// عنوان_الوكيل: اختياري، 'user:pass@127.0.0.1:1080' كاحتياطي في حال فشل رابط_قائمة_الوكلاء.
// رابط_قائمة_الوكلاء: اختياري، رابط لقائمة عناوين SOCKS5، مثل 'https://example.com/socks5_list.txt'.
// مهلة_الوكيل: اختياري، مهلة اتصال SOCKS5 بالمللي ثانية (الافتراضي 5000).
// تفعيل_الوكيل: اختياري، 'true' لتفعيل وكيل SOCKS5، 'false' لتعطيله (الافتراضي 'true').
// وكيل_عام: اختياري، 'true' لوكيل SOCKS5 عام، 'false' للاستخدام فقط عند فشل الاتصال المباشر (الافتراضي 'true').
// إخفاء: اختياري، 'true' لإخفاء الاشتراك (يعيد رسالة ساخرة).
// مفتاح_سري: اختياري، مفتاح سري لمصادقة اتصال WS.
// تفعيل_المفتاح: اختياري، 'true' لتفعيل المصادقة بالمفتاح السري.
// رسالة_ساخرة: اختياري، الرسالة التي تُعاد عند إخفاء الاشتراك.
//
// ====================================================================

import { connect } from 'cloudflare:sockets';

const اسم_بروتوكول_VL = 'vl';
const لاحقة_البروتوكول = 'ess';
const فاصل_البروتوكول = '://';

//////////////////////////////////////////////////////////////////////////كتلة_الإعدادات////////////////////////////////////////////////////////////////////////
let معرف_الاشتراك = "123456";
let UUID_العميل = "25dce6e6-1c37-4e8c-806b-5ef8affd9f55";

let تفعيل_المفتاح_السري = false;
let المفتاح_السري = "";

let إخفاء_الاشتراك = false;
let الرسالة_الساخرة = "أوه، لقد وجدتني، لكني لن أريك أي شيء، ألا يزعجك هذا، هاهاها";

let عناوين_IP_المفضلة = ['cloudflare-ddns.zone.id:443#الولايات المتحدة الأمريكية - العقدة الافتراضية لـ CDN Cloudflare'];
let رابط_قائمة_IP_المفضلة = [''];

let اسم_العقدة = 'إصدار_SOCKS5';

// إعدادات SOCKS5
let تفعيل_وكيل_SOCKS5 = true;
let تفعيل_وكيل_SOCKS5_العام = true;
let عنوان_وكيل_SOCKS5_احتياطي = '';

// جديد: رابط قائمة عناوين SOCKS5
let رابط_قائمة_SOCKS5 = '';

// قائمة عناوين SOCKS5 ووقت التحديث الأخير
let قائمة_عناوين_SOCKS5 = [];
let آخر_وقت_تحديث_SOCKS5 = 0;
const فاصل_تحديث_SOCKS5 = 5 * 60 * 1000; // 5 دقائق بالمللي ثانية
const مهلة_اتصال_SOCKS5 = 5000; // مهلة اتصال SOCKS5 بالمللي ثانية

const خوادم_DOH = [
  "https://dns.google/dns-query",
  "https://cloudflare-dns.com/dns-query",
  "https://1.1.1.1/dns-query",
  "https://dns.quad9.net/dns-query",
];

// --- جديد: متغيرات ووظيفة صفحة التمويه ---
const رابط_صفحة_التمويه = 'https://cf-worker-dir-bke.pages.dev/';

async function عرض_صفحة_التمويه() {
  try {
    const res = await fetch(رابط_صفحة_التمويه, { cf: { cacheEverything: true } });
    return new Response(res.body, res);
  } catch {
    return new Response(
      `<!DOCTYPE html>
       <html>
         <head><title>أهلاً وسهلاً</title></head>
         <body><h1>تم نشر عامل Cloudflare بنجاح</h1>
         <p>هذه صفحة تمويه ثابتة (فشل التحميل من مصدر بعيد).</p></body>
       </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }
}
// --- نهاية_الجديد ---

const الحصول_على_متغير_بيئة = (الاسم, الافتراضي, البيئة) => {
  const القيمة_الخام = import.meta?.env?.[الاسم] ?? البيئة?.[الاسم];
  if (القيمة_الخام === undefined || القيمة_الخام === null || القيمة_الخام === '') return الافتراضي;
  if (typeof القيمة_الخام === 'string') {
    const القيمة_المقصوصة = القيمة_الخام.trim();
    if (القيمة_المقصوصة === 'true') return true;
    if (القيمة_المقصوصة === 'false') return false;
    if (القيمة_المقصوصة.includes('\n')) {
      return القيمة_المقصوصة.split('\n').map(item => item.trim()).filter(Boolean);
    }
    if (!isNaN(القيمة_المقصوصة) && القيمة_المقصوصة !== '') return Number(القيمة_المقصوصة);
    return القيمة_المقصوصة;
  }
  return القيمة_الخام;
};

// جديد: وظيفة لتحميل قائمة عناوين SOCKS5
async function تحميل_قائمة_عناوين_SOCKS5() {
  if (!رابط_قائمة_SOCKS5) {
    console.log('رابط_قائمة_الوكلاء غير مهيأ، سيتم تخطي تحميل قائمة SOCKS5.');
    return;
  }

  const الوقت_الحالي = Date.now();
  if (الوقت_الحالي - آخر_وقت_تحديث_SOCKS5 < فاصل_تحديث_SOCKS5 && قائمة_عناوين_SOCKS5.length > 0) {
    return;
  }

  console.log('جاري تحميل قائمة عناوين SOCKS5...');
  try {
    const response = await fetch(رابط_قائمة_SOCKS5);
    if (!response.ok) {
      throw new Error(`فشل تحميل قائمة عناوين SOCKS5: ${response.statusText} (الحالة: ${response.status})`);
    }
    const text = await response.text();
    const addresses = text.split('\n')
                           .map(line => line.trim())
                           .filter(line => line && !line.startsWith('#'));

    if (addresses.length > 0) {
      قائمة_عناوين_SOCKS5 = addresses;
      آخر_وقت_تحديث_SOCKS5 = الوقت_الحالي;
      console.log(`تم تحميل ${قائمة_عناوين_SOCKS5.length} عنوان SOCKS5 بنجاح.`);
    } else {
      console.warn('ملف قائمة عناوين SOCKS5 فارغ أو لا يحتوي على عناوين صالحة. سيتم الاحتفاظ بالقائمة الناجحة السابقة إذا كانت موجودة.');
    }
  } catch (e) {
    console.error(`فشل تحميل قائمة عناوين SOCKS5: ${e.message}. سيتم استخدام الاحتياطي (إذا كان مهيأ) أو القائمة الناجحة الأخيرة.`);
  }
}

export default {
  async fetch(request, env) {
    // قراءة متغيرات البيئة
    معرف_الاشتراك = الحصول_على_متغير_بيئة('ID', معرف_الاشتراك, env);
    UUID_العميل = الحصول_على_متغير_بيئة('UUID', UUID_العميل, env);
    عناوين_IP_المفضلة = الحصول_على_متغير_بيئة('IP', عناوين_IP_المفضلة, env);
    رابط_قائمة_IP_المفضلة = الحصول_على_متغير_بيئة('TXT', رابط_قائمة_IP_المفضلة, env);
    المفتاح_السري = الحصول_على_متغير_بيئة('私钥', المفتاح_السري, env);
    إخفاء_الاشتراك = الحصول_على_متغير_بيئة('隐藏', إخفاء_الاشتراك, env);
    تفعيل_المفتاح_السري = الحصول_على_متغير_بيئة('私钥开关', تفعيل_المفتاح_السري, env);
    الرسالة_الساخرة = الحصول_على_متغير_بيئة('嘲讽语', الرسالة_الساخرة, env);
    اسم_العقدة = الحصول_على_متغير_بيئة('我的节点名字', اسم_العقدة, env);

    // قراءة متغيرات البيئة المتعلقة بـ SOCKS5
    تفعيل_وكيل_SOCKS5 = الحصول_على_متغير_بيئة('SOCKS5_ENABLE', تفعيل_وكيل_SOCKS5, env);
    تفعيل_وكيل_SOCKS5_العام = الحصول_على_متغير_بيئة('SOCKS5_GLOBAL', تفعيل_وكيل_SOCKS5_العام, env);
    عنوان_وكيل_SOCKS5_احتياطي = الحصول_على_متغير_بيئة('SOCKS5_ADDRESS', عنوان_وكيل_SOCKS5_احتياطي, env);
    رابط_قائمة_SOCKS5 = الحصول_على_متغير_بيئة('SOCKS5_TXT_URL', رابط_قائمة_SOCKS5, env);

    await تحميل_قائمة_عناوين_SOCKS5();

    const upgradeHeader = request.headers.get('Upgrade');
    const url = new URL(request.url);

    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      // التعامل مع الطلبات التي ليست WebSocket
      if (رابط_قائمة_IP_المفضلة) {
        const urlArray = Array.isArray(رابط_قائمة_IP_المفضلة) ? رابط_قائمة_IP_المفضلة : [رابط_قائمة_IP_المفضلة];
        const allNodes = [];
        for (const link of urlArray) {
          try {
            const response = await fetch(link);
            const text = await response.text();
            const nodes = text.split('\n').map(line => line.trim()).filter(line => line);
            allNodes.push(...nodes);
          } catch (e) {
            console.warn(`فشل جلب أو تحليل عناوين IP المفضلة من الرابط: ${link}`, e);
          }
        }
        if (allNodes.length > 0) عناوين_IP_المفضلة = allNodes;
      }
      switch (url.pathname) {
        case '/':
          return عرض_صفحة_التمويه();
        case `/${معرف_الاشتراك}`: {
          const sub = إنشاء_صفحة_الاشتراك(معرف_الاشتراك, request.headers.get('Host'));
          return new Response(sub, {
            status: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" }
          });
        }
        case `/${معرف_الاشتراك}/${اسم_بروتوكول_VL}${لاحقة_البروتوكول}`: {
          if (إخفاء_الاشتراك) {
            return new Response(الرسالة_الساخرة, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          } else {
            const config = إنشاء_ملف_الإعدادات(request.headers.get('Host'));
            return new Response(config, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          }
        }
        default:
          return new Response('أهلاً بالعالم!', { status: 200 });
      }
    } else {
      // التعامل مع طلبات ترقية WebSocket
      if (تفعيل_المفتاح_السري) {
        const k = request.headers.get('my-key');
        if (k !== المفتاح_السري) return new Response('فشل التحقق من المفتاح السري', { status: 403 });
      }
      const enc = request.headers.get('sec-websocket-protocol');
      const data = فك_تشفير_Base64(enc);
      if (!تفعيل_المفتاح_السري && الحصول_على_UUID_VL(new Uint8Array(data.slice(1, 17))) !== UUID_العميل) {
        return new Response('UUID غير صالح', { status: 403 });
      }
      try {
        const { tcpSocket, initialData } = await تحليل_رأس_VL(data);
        return await التعامل_مع_ترقية_WS(request, tcpSocket, initialData);
      } catch (e) {
        console.error("فشل تحليل بروتوكول VL أو اتصال TCP:", e);
        return new Response(`بوابة سيئة: ${e.message}`, { status: 502 });
      }
    }
  }
};

async function التعامل_مع_ترقية_WS(request, tcpSocket, initialData) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  نقل_البيانات_بين_التيارات(server, tcpSocket, initialData);
  return new Response(null, { status: 101, webSocket: client });
}

function فك_تشفير_Base64(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(str), c => c.charCodeAt(0)).buffer;
}

async function تحليل_رأس_VL(buf) {
  const b = new DataView(buf), c = new Uint8Array(buf);
  const dataPosition = c[17];
  const portIndex = 18 + dataPosition + 1;
  const targetPort = b.getUint16(portIndex);
  if (targetPort === 53) throw new Error('تم رفض اتصالات DNS');
  const addressIndex = portIndex + 2;
  let addressType = c[addressIndex];
  let addressInfoIndex = addressIndex + 1;
  let targetAddress;
  let addressLength;

  switch (addressType) {
    case 1: // IPv4
      addressLength = 4;
      targetAddress = Array.from(c.slice(addressInfoIndex, addressInfoIndex + addressLength)).join('.');
      break;
    case 2: // Domain
      addressLength = c[addressInfoIndex];
      addressInfoIndex += 1;
      const domain = new TextDecoder().decode(c.slice(addressInfoIndex, addressInfoIndex + addressLength));
      targetAddress = await البحث_عن_أسرع_IP(domain);
      if (targetAddress !== domain) {
        addressType = targetAddress.includes(':') ? 3 : 1;
      }
      break;
    case 3: // IPv6
      addressLength = 16;
      const ipv6 = [];
      const ipv6View = new DataView(buf, addressInfoIndex, 16);
      for (let i = 0; i < 8; i++) ipv6.push(ipv6View.getUint16(i * 2).toString(16));
      targetAddress = ipv6.join(':');
      break;
    default:
      throw new Error('نوع عنوان الهدف غير صالح');
  }

  const initialData = buf.slice(addressInfoIndex + addressLength);
  let tcpSocket;

  if (تفعيل_وكيل_SOCKS5) {
    if (تفعيل_وكيل_SOCKS5_العام) {
      tcpSocket = await إنشاء_اتصال_Socks5(addressType, targetAddress, targetPort);
    } else {
      try {
        tcpSocket = connect({ hostname: targetAddress, port: targetPort });
        await tcpSocket.opened;
      } catch (e) {
        console.warn(`فشل الاتصال المباشر بـ ${targetAddress}:${targetPort}، سيتم محاولة وكيل SOCKS5: ${e.message}`);
        tcpSocket = await إنشاء_اتصال_Socks5(addressType, targetAddress, targetPort);
      }
    }
  } else {
    tcpSocket = connect({ hostname: targetAddress, port: targetPort });
  }

  await tcpSocket.opened;
  return { tcpSocket, initialData };
}

async function إنشاء_اتصال_Socks5(addressType, targetAddress, targetPort) {
  let proxiesToTry = [];

  if (قائمة_عناوين_SOCKS5.length > 0) {
    proxiesToTry = [...قائمة_عناوين_SOCKS5];
  }

  if (proxiesToTry.length === 0 && عنوان_وكيل_SOCKS5_احتياطي) {
    proxiesToTry.push(عنوان_وكيل_SOCKS5_احتياطي);
  }

  if (proxiesToTry.length === 0) {
    throw new Error('لم يتم تهيئة أي عنوان وكيل SOCKS5 (رابط_قائمة_الوكلاء أو عنوان_الوكيل).');
  }

  const connectionPromises = proxiesToTry.map(async (proxyConfig, index) => {
    let tcpSocket = null;
    try {
      const { username, password, host, port } = تحليل_عنوان_Socks5(proxyConfig);
      console.log(`محاولة الاتصال بوكيل SOCKS5 بالتوازي: ${username ? 'مع المصادقة' : 'بدون مصادقة'} ${host}:${port} (وكيل ${index + 1}/${proxiesToTry.length})`);

      const timeoutPromise = new Promise((resolve, reject) => {
        const id = setTimeout(() => {
          reject(new Error(`انتهت مهلة الاتصال: ${host}:${port}`));
        }, مهلة_اتصال_SOCKS5);
      });

      tcpSocket = await Promise.race([
        إقامة_اتصال_Socks5(username, password, host, port, addressType, targetAddress, targetPort),
        timeoutPromise
      ]);

      console.log(`تم الاتصال بوكيل SOCKS5 بنجاح: ${host}:${port}`);
      return { socket: tcpSocket, config: proxyConfig };
    } catch (e) {
      console.warn(`فشل اتصال وكيل SOCKS5 أو انتهت مهلته (${proxyConfig}): ${e.message}`);
      if (tcpSocket) {
        try { tcpSocket.close(); } catch (closeErr) { console.warn("خطأ في إغلاق الاتصال الفاشل:", closeErr); }
      }
      return Promise.reject(new Error(`فشل الوكيل: ${proxyConfig} - ${e.message}`));
    }
  });

  try {
    const { socket } = await Promise.any(connectionPromises);
    return socket;
  } catch (aggregateError) {
    console.error(`فشلت جميع محاولات وكيل SOCKS5:`, aggregateError.errors.map(e => e.message).join('; '));
    throw new Error('فشلت جميع محاولات وكيل SOCKS5.');
  }
}

async function إقامة_اتصال_Socks5(username, password, s5Host, s5Port, addressType, targetAddress, targetPort) {
  const s5Socket = connect({ hostname: s5Host, port: s5Port });
  let writer, reader;
  try {
    await s5Socket.opened;
    writer = s5Socket.writable.getWriter();
    reader = s5Socket.readable.getReader();
    const encoder = new TextEncoder();

    // SOCKS5 تفاوض المصادقة
    const authMethods = new Uint8Array([5, 2, 0, 2]);
    await writer.write(authMethods);
    const authResponse = (await reader.read()).value;

    if (!authResponse || authResponse.length < 2) {
      throw new Error('استجابة تفاوض المصادقة SOCKS5 غير صالحة.');
    }

    if (authResponse[1] === 0x02) {
      if (!username || !password) {
        throw new Error(`وكيل SOCKS5 يتطلب المصادقة، ولكن لم يتم تهيئة أي بيانات اعتماد.`);
      }
      const authPacket = new Uint8Array([1, username.length, ...encoder.encode(username), password.length, ...encoder.encode(password)]);
      await writer.write(authPacket);
      const authResult = (await reader.read()).value;
      if (!authResult || authResult.length < 2 || authResult[0] !== 0x01 || authResult[1] !== 0x00) {
        throw new Error(`خطأ في اسم المستخدم/كلمة المرور SOCKS5 أو فشل المصادقة.`);
      }
    } else if (authResponse[1] === 0x00) {
      // لا حاجة للمصادقة
    } else {
      throw new Error(`طريقة مصادقة SOCKS5 غير مدعومة: ${authResponse[1]}`);
    }

    // SOCKS5 الاتصال بالهدف
    let targetAddressBytes;
    switch (addressType) {
      case 1: // IPv4
        targetAddressBytes = new Uint8Array([1, ...targetAddress.split('.').map(Number)]);
        break;
      case 2: // Domain
        targetAddressBytes = new Uint8Array([3, targetAddress.length, ...encoder.encode(targetAddress)]);
        break;
      case 3: // IPv6
        const ipv6Parts = targetAddress.split(':');
        const ipv6Bytes = [];
        let doubleColonHandled = false;
        for (let i = 0; i < ipv6Parts.length; i++) {
          let part = ipv6Parts[i];
          if (part === '') {
            if (!doubleColonHandled) {
              let numMissingParts = 8 - (ipv6Parts.length - 1);
              if (ipv6Parts[0] === '' && i === 0) numMissingParts++;
              if (ipv6Parts[ipv6Parts.length - 1] === '' && i === ipv6Parts.length - 1) numMissingParts++;
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
        while (ipv6Bytes.length < 16) {
            ipv6Bytes.push(0x00, 0x00);
        }
        targetAddressBytes = new Uint8Array([4, ...ipv6Bytes]);
        break;
      default:
        throw new Error('نوع عنوان هدف SOCKS5 غير صالح');
    }

    const connectPacket = new Uint8Array([5, 1, 0, ...targetAddressBytes, targetPort >> 8, targetPort & 0xff]);
    await writer.write(connectPacket);
    const connectResponse = (await reader.read()).value;

    if (!connectResponse || connectResponse.length < 2 || connectResponse[0] !== 0x05 || connectResponse[1] !== 0x00) {
      throw new Error(`فشل اتصال هدف SOCKS5. الهدف: ${targetAddress}:${targetPort}, رمز استجابة SOCKS5: ${connectResponse ? connectResponse[1] : 'لا يوجد استجابة'}`);
    }

    writer.releaseLock();
    reader.releaseLock();
    return s5Socket;
  } catch (e) {
    if (writer) writer.releaseLock();
    if (reader) reader.releaseLock();
    if (s5Socket) s5Socket.close();
    throw e;
  }
}

async function نقل_البيانات_بين_التيارات(ws, tcp, initialData) {
  // إرسال استجابة نجاح الاتصال
  ws.send(new Uint8Array([0, 0]));

  const writer = tcp.writable.getWriter();
  const reader = tcp.readable.getReader();

  // كتابة البيانات الأولية من العميل
  if (initialData && initialData.byteLength > 0) {
    await writer.write(initialData).catch(err => console.error("فشل كتابة البيانات الأولية إلى TCP:", err));
  }

  // نقل البيانات من WebSocket إلى TCP
  ws.addEventListener('message', async e => {
    if (e.data instanceof ArrayBuffer) {
      try {
        await writer.write(e.data);
      } catch (err) {
        console.error("فشل الكتابة من WebSocket إلى TCP:", err);
      }
    } else {
      console.warn("تم استقبال بيانات ليست ArrayBuffer (WebSocket):", e.data);
    }
  });

  // نقل البيانات من TCP إلى WebSocket
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        try {
          ws.send(value);
        } catch (sendErr) {
          console.error("فشل إرسال البيانات من TCP إلى WebSocket:", sendErr);
          break;
        }
      }
    }
  } catch (readErr) {
    console.error("فشل قراءة البيانات من TCP:", readErr);
  } finally {
    try { ws.close(); } catch (e) { console.warn("فشل إغلاق WebSocket:", e); }
    try { reader.cancel(); } catch (e) { console.warn("فشل إلغاء قارئ TCP:", e); }
    try { writer.releaseLock(); } catch (e) { console.warn("فشل تحرير قفل كاتب TCP:", e); }
    try { tcp.close(); } catch (e) { console.warn("فشل إغلاق اتصال TCP:", e); }
    console.log("تم إغلاق خط النقل.");
  }
}

function الحصول_على_UUID_VL(a) {
  const hex = Array.from(a, v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function البحث_عن_أسرع_IP(domain) {
  const إنشاء_طلبات_Doh = (type) =>
    خوادم_DOH.map(dohUrl =>
      fetch(`${dohUrl}?name=${domain}&type=${type}`, {
        headers: { 'Accept': 'application/dns-json' }
      }).then(res => res.json())
        .then(json => {
          const ip = json.Answer?.find(r => r.type === (type === 'A' ? 1 : 28))?.data;
          if (ip) return ip;
          return Promise.reject(`لا يوجد سجل ${type}`);
        })
        .catch(err => Promise.reject(`${dohUrl} فشل طلب ${type}: ${err}`))
    );
  try {
    return await Promise.any(إنشاء_طلبات_Doh('A'));
  } catch (e) {
    try {
      return await Promise.any(إنشاء_طلبات_Doh('AAAA'));
    } catch (e2) {
      console.warn(`فشل طلب DOH لـ ${domain} (كلا من IPv4 و IPv6): ${e2.message}`);
      return domain;
    }
  }
}

function تحليل_عنوان_Socks5(addressString) {
  const atIndex = addressString.lastIndexOf("@");
  if (atIndex === -1) {
    const [host, port] = تحليل_المضيف_والمنفذ(addressString);
    return { username: '', password: '', host, port };
  }
  const authPart = addressString.slice(0, atIndex);
  const hostPart = addressString.slice(atIndex + 1);
  const lastColonInAuth = authPart.lastIndexOf(":");
  const username = lastColonInAuth > -1 ? authPart.slice(0, lastColonInAuth) : '';
  const password = lastColonInAuth > -1 ? authPart.slice(lastColonInAuth + 1) : '';
  const [host, port] = تحليل_المضيف_والمنفذ(hostPart);
  return { username, password, host, port };
}

function تحليل_المضيف_والمنفذ(hostPart) {
  let host, port;
  if (hostPart.startsWith('[')) {
    const endBracket = hostPart.indexOf(']');
    if (endBracket === -1) throw new Error('تنسيق عنوان IPv6 غير صالح');
    host = hostPart.slice(1, endBracket);
    const portString = hostPart.slice(endBracket + 1);
    port = portString.startsWith(':') ? Number(portString.slice(1)) : 443;
    if (isNaN(port) || port <= 0 || port > 65535) port = 443;
  } else {
    const lastColon = hostPart.lastIndexOf(':');
    if (lastColon > -1 && !isNaN(Number(hostPart.slice(lastColon + 1)))) {
      host = hostPart.slice(0, lastColon);
      port = Number(hostPart.slice(lastColon + 1));
    } else {
      host = hostPart;
      port = 443;
    }
  }
  return [host, port];
}

function إنشاء_صفحة_الاشتراك(id, host) {
  return `
1.وظيفة المفتاح السري لهذا العامل تدعم فقط الاشتراكات العامة، يرجى إيقاف تشغيل وظيفة المفتاح السري للآخرين.
2.للمتطلبات الأخرى، يرجى البحث بنفسك.
اشتراك عام: https${فاصل_البروتوكول}${host}/${id}/${اسم_بروتوكول_VL}${لاحقة_البروتوكول}
`;
}

function إنشاء_ملف_الإعدادات(host) {
  const isMyPreferredEmpty = عناوين_IP_المفضلة.length === 0 || (عناوين_IP_المفضلة.length === 1 && عناوين_IP_المفضلة[0] === '');
  const isMyPreferredTxtEmpty = رابط_قائمة_IP_المفضلة.length === 0 || (رابط_قائمة_IP_المفضلة.length === 1 && رابط_قائمة_IP_المفضلة[0] === '');
  const effectivePreferredIps = (!isMyPreferredEmpty || !isMyPreferredTxtEmpty) ? عناوين_IP_المفضلة : [`${host}:443#عقدة_احتياطية`];

  if (تفعيل_المفتاح_السري) {
    return `الرجاء إيقاف تشغيل وظيفة المفتاح السري أولاً`;
  } else {
    return effectivePreferredIps.map(item => {
      const parts = item.split("@");
      let mainPart = parts[0];
      let tlsOption = 'security=tls';

      if (parts.length > 1) {
          const tlsConfig = parts[1];
          if (tlsConfig.toLowerCase() === 'notls') {
              tlsOption = 'security=none';
          }
      }

      const [addrPort, name = اسم_العقدة] = mainPart.split("#");
      const addrParts = addrPort.split(":");
      const port = addrParts.length > 1 && !isNaN(Number(addrParts[addrParts.length - 1])) ? Number(addrParts.pop()) : 443;
      const addr = addrParts.join(":");

      return `${اسم_بروتوكول_VL}${لاحقة_البروتوكول}${فاصل_البروتوكول}${UUID_العميل}@${addr}:${port}?encryption=none&${tlsOption}&sni=${host}&type=ws&host=${host}&path=%2F%3Ded%3D2560#${name}`;
    }).join("\n");
  }
																	   }
