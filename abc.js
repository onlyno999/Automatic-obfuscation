// ====================================================================
// สหายชาวไร่ของ Cloudflare: เส้นทาง VL กับสายลับ SOCKS5 (พร้อมการเลือกสายลับ SOCKS5 หลายตัว)
// --------------------------------------------------------------------

// บัญชีลับของชาวไร่ (ตัวแปรสภาพแวดล้อม) หมายเหตุ:
//   รหัสลับใหญ่    ต้องมี, รหัสลูกค้าของ VL
//   รหัสลับเล็ก    เลือกได้, เส้นทางการสมัคร (ค่าเริ่มต้น 123456)
//   รังสายลับ     เลือกได้, ที่อยู่เก่า user:pass@127.0.0.1:1080 ใช้เมื่อรายชื่อสายลับล้มเหลว
//   รายชื่อสายลับ  เลือกได้, รายชื่อรังสายลับ เช่น: https://example.com/socks5_list.txt
//   สายลับจำกัดเวลา  = 5000; // เวลาเชื่อมต่อสายลับ (มิลลิวินาที)
//   เปิดใช้สายลับ  เลือกได้, true|false, true เปิดใช้สายลับ, false ปิด (ค่าเริ่มต้น true)
//   สายลับรวมหมู่  เลือกได้, true|false, true ให้ทุกคนใช้สายลับ, false เฉพาะเมื่อเชื่อมต่อตรงล้มเหลว (ค่าเริ่มต้น true)
//   แผนที่ขุมทรัพย์  เลือกได้, true|false, true เมื่อเรียกใช้ จะให้แค่คำพูดลับ
//   ของวิเศษลับ    เลือกได้, ของวิเศษส่วนตัวสำหรับยืนยันตัวตน
//   สวิตช์วิเศษ    เลือกได้, true|false, จะเปิดใช้การยืนยันตัวตนด้วยของวิเศษหรือไม่
//   คำพูดลับ      เลือกได้, คำพูดลับที่จะตอบเมื่อซ่อนแผนที่
//
// ====================================================================

import { connect } from 'cloudflare:sockets';

const รหัสเส้นทาง = 'vl';
const รหัสส่วนท้าย = 'ess';
const คำสั่งเชื่อมต่อ = '://';

//////////////////////////////////////////////////////////////////////////กฎของรังโจร////////////////////////////////////////////////////////////////////////
let เส้นทางลับ = "123456";
let รหัสลับใหญ่ = "25dce6e6-1c37-4e8c-806b-5ef8affd9f55";

let เปิดใช้ของวิเศษ = false;
let ของวิเศษลับ = "";

let ซ่อนแผนที่ = false;
let คำพูดลับ = "โอ๊ย เจ้าเจอข้าแล้ว แต่ข้าไม่ให้เจ้าดูหรอก โกรธไหมล่ะ ฮี่ฮี่ฮี่";

let รังลับที่ชอบ = ['cloudflare-ddns.zone.id:443#รังโจรหลักในอเมริกา'];
let รายชื่อรังลับที่ชอบ = [''];

let ชื่อรังของข้า = 'รุ่นสายลับ';

// กฎของรังสายลับ
let เปิดใช้รังสายลับ = true;
let สายลับทั้งหมด = true;
let รังสายลับสำรอง = '';

// กฎใหม่: รายชื่อรังสายลับ
let รายชื่อสายลับ = '';

// กลุ่มสายลับและเวลาอัปเดตล่าสุด
let กลุ่มสายลับ = [];
let เวลาอัปเดตล่าสุด = 0;
const ระยะเวลาการอัปเดต = 5 * 60 * 1000; // 5 นาที (มิลลิวินาที)
const เวลาเชื่อมต่อสายลับ = 5000; // การเชื่อมต่อสายลับหมดเวลา (มิลลิวินาที)

const จุดติดต่อสายลับ = [
  "https://dns.google/dns-query",
  "https://cloudflare-dns.com/dns-query",
  "https://1.1.1.1/dns-query",
  "https://dns.quad9.net/dns-query",
];

// --- กฎใหม่: การปลอมตัวและหน้าเว็บรังโจร ---
const หน้าเว็บปลอม = 'https://cf-worker-dir-bke.pages.dev/';

async function ปลอมตัวเป็นบ้านคนทั่วไป() {
  try {
    const res = await fetch(หน้าเว็บปลอม, { cf: { cacheEverything: true } });
    return new Response(res.body, res);
  } catch {
    return new Response(
      `<!DOCTYPE html>
       <html>
         <head><title>ยินดีต้อนรับ</title></head>
         <body><h1>สหายชาวไร่ของ Cloudflare ได้ตั้งรังที่นี่แล้ว</h1>
         <p>หน้านี้เป็นหน้าปลอมตัวแบบคงที่ (การเชื่อมต่อระยะไกลล้มเหลว)</p></body>
       </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }
}
// --- จบกฎ ---

const เช็คตัวแปรสภาพแวดล้อม = (ชื่อ, ตัวสำรอง, ที่อยู่) => {
  const ค่าเริ่มต้น = import.meta?.env?.[ชื่อ] ?? ที่อยู่?.[ชื่อ];
  if (ค่าเริ่มต้น === undefined || ค่าเริ่มต้น === null || ค่าเริ่มต้น === '') return ตัวสำรอง;
  if (typeof ค่าเริ่มต้น === 'string') {
    const ค่าที่ตัดแต่ง = ค่าเริ่มต้น.trim();
    if (ค่าที่ตัดแต่ง === 'true') return true;
    if (ค่าที่ตัดแต่ง === 'false') return false;
    if (ค่าที่ตัดแต่ง.includes('\n')) {
      return ค่าที่ตัดแต่ง.split('\n').map(item => item.trim()).filter(Boolean);
    }
    if (!isNaN(ค่าที่ตัดแต่ง) && ค่าที่ตัดแต่ง !== '') return Number(ค่าที่ตัดแต่ง);
    return ค่าที่ตัดแต่ง;
  }
  return ค่าเริ่มต้น;
};

// กฎใหม่: โหลดรายชื่อรังสายลับ
async function โหลดรายชื่อรังสายลับ() {
  if (!รายชื่อสายลับ) {
    console.log('รายชื่อสายลับไม่ได้ตั้งค่าไว้');
    return;
  }

  const เวลาปัจจุบัน = Date.now();
  if (เวลาปัจจุบัน - เวลาอัปเดตล่าสุด < ระยะเวลาการอัปเดต && กลุ่มสายลับ.length > 0) {
    return;
  }

  console.log('กำลังโหลดรายชื่อสายลับ...');
  try {
    const response = await fetch(รายชื่อสายลับ);
    if (!response.ok) {
      throw new Error(`โหลดรายชื่อสายลับล้มเหลว: ${response.statusText} (สถานะ: ${response.status})`);
    }
    const text = await response.text();
    const ที่อยู่ทั้งหมด = text.split('\n')
                           .map(line => line.trim())
                           .filter(line => line && !line.startsWith('#'));

    if (ที่อยู่ทั้งหมด.length > 0) {
      กลุ่มสายลับ = ที่อยู่ทั้งหมด;
      เวลาอัปเดตล่าสุด = เวลาปัจจุบัน;
      console.log(`โหลดที่อยู่สายลับสำเร็จ ${กลุ่มสายลับ.length} ที่อยู่`);
    } else {
      console.warn('ไฟล์รายชื่อสายลับว่างเปล่าหรือไม่มีที่อยู่ที่ถูกต้อง จะใช้รายชื่อที่เคยโหลดสำเร็จครั้งล่าสุด');
    }
  } catch (e) {
    console.error(`โหลดรายชื่อสายลับล้มเหลว: ${e.message} จะใช้รังสำรอง (ถ้าตั้งค่าไว้) หรือรายชื่อที่เคยโหลดสำเร็จ`);
  }
}

export default {
  async fetch(request, env) {
    // เช็คตัวแปรสภาพแวดล้อม
    เส้นทางลับ = เช็คตัวแปรสภาพแวดล้อม('ID', เส้นทางลับ, env);
    รหัสลับใหญ่ = เช็คตัวแปรสภาพแวดล้อม('UUID', รหัสลับใหญ่, env);
    รังลับที่ชอบ = เช็คตัวแปรสภาพแวดล้อม('IP', รังลับที่ชอบ, env);
    รายชื่อรังลับที่ชอบ = เช็คตัวแปรสภาพแวดล้อม('TXT', รายชื่อรังลับที่ชอบ, env);
    ของวิเศษลับ = เช็คตัวแปรสภาพแวดล้อม('私钥', ของวิเศษลับ, env);
    ซ่อนแผนที่ = เช็คตัวแปรสภาพแวดล้อม('隐藏', ซ่อนแผนที่, env);
    เปิดใช้ของวิเศษ = เช็คตัวแปรสภาพแวดล้อม('私钥开关', เปิดใช้ของวิเศษ, env);
    คำพูดลับ = เช็คตัวแปรสภาพแวดล้อม('嘲讽语', คำพูดลับ, env);
    ชื่อรังของข้า = เช็คตัวแปรสภาพแวดล้อม('我的节点名字', ชื่อรังของข้า, env);

    // เช็คตัวแปรเกี่ยวกับรังสายลับ
    เปิดใช้รังสายลับ = เช็คตัวแปรสภาพแวดล้อม('SOCKS5_ENABLE', เปิดใช้รังสายลับ, env);
    สายลับทั้งหมด = เช็คตัวแปรสภาพแวดล้อม('SOCKS5_GLOBAL', สายลับทั้งหมด, env);
    รังสายลับสำรอง = เช็คตัวแปรสภาพแวดล้อม('SOCKS5_ADDRESS', รังสายลับสำรอง, env);
    รายชื่อสายลับ = เช็คตัวแปรสภาพแวดล้อม('SOCKS5_TXT_URL', รายชื่อสายลับ, env);

    await โหลดรายชื่อรังสายลับ();

    const รหัสเชื่อมต่อ = request.headers.get('Upgrade');
    const url = new URL(request.url);

    if (!รหัสเชื่อมต่อ || รหัสเชื่อมต่อ !== 'websocket') {
      // ไม่ใช่การเชื่อมต่อลับ, จัดการคำขอทั่วไป
      if (รายชื่อรังลับที่ชอบ) {
        const urlArray = Array.isArray(รายชื่อรังลับที่ชอบ) ? รายชื่อรังลับที่ชอบ : [รายชื่อรังลับที่ชอบ];
        const ทุกรัง = [];
        for (const link of urlArray) {
          try {
            const response = await fetch(link);
            const text = await response.text();
            const รังที่พบ = text.split('\n').map(line => line.trim()).filter(line => line);
            ทุกรัง.push(...รังที่พบ);
          } catch (e) {
            console.warn(`การติดต่อกับรังลับล้มเหลว: ${link}`, e);
          }
        }
        if (ทุกรัง.length > 0) รังลับที่ชอบ = ทุกรัง;
      }
      switch (url.pathname) {
        case '/':
          return ปลอมตัวเป็นบ้านคนทั่วไป();
        case `/${เส้นทางลับ}`: {
          const sub = สร้างหน้าแผนที่(เส้นทางลับ, request.headers.get('Host'));
          return new Response(sub, {
            status: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" }
          });
        }
        case `/${เส้นทางลับ}/${รหัสเส้นทาง}${รหัสส่วนท้าย}`: {
          if (ซ่อนแผนที่) {
            return new Response(คำพูดลับ, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          } else {
            const config = สร้างไฟล์การตั้งค่า(request.headers.get('Host'));
            return new Response(config, {
              status: 200,
              headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
          }
        }
        default:
          return new Response('ใครกัน!', { status: 200 });
      }
    } else {
      // ได้รหัสลับ, จัดการการเชื่อมต่อลับ
      if (เปิดใช้ของวิเศษ) {
        const k = request.headers.get('my-key');
        if (k !== ของวิเศษลับ) return new Response('ของวิเศษไม่ถูกต้อง, ฆ่ามัน!', { status: 403 });
      }
      const การเข้ารหัส = request.headers.get('sec-websocket-protocol');
      const ข้อมูล = ถอดรหัสลับ(การเข้ารหัส);
      if (!เปิดใช้ของวิเศษ && รับรหัสลับใหญ่(new Uint8Array(ข้อมูล.slice(1, 17))) !== รหัสลับใหญ่) {
        return new Response('รหัสลับไม่ถูกต้อง', { status: 403 });
      }
      try {
        const { tcpSocket, ข้อมูลเริ่มต้น } = await แยกแยะรหัสลับ(ข้อมูล);
        return await จัดการการเชื่อมต่อลับ(request, tcpSocket, ข้อมูลเริ่มต้น);
      } catch (e) {
        console.error("การแยกแยะรหัสลับหรือการเชื่อมต่อล้มเหลว:", e);
        return new Response(`การเชื่อมต่อล้มเหลว: ${e.message}`, { status: 502 });
      }
    }
  }
};

async function จัดการการเชื่อมต่อลับ(คำขอ, การเชื่อมต่อ, ข้อมูลเริ่มต้น) {
  const { 0: ลูกค้าทั่วไป, 1: คนส่งของ } = new WebSocketPair();
  คนส่งของ.accept();
  ส่งข้อมูล(คนส่งของ, การเชื่อมต่อ, ข้อมูลเริ่มต้น);
  return new Response(null, { status: 101, webSocket: ลูกค้าทั่วไป });
}

function ถอดรหัสลับ(ข้อความ) {
  ข้อความ = ข้อความ.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(ข้อความ), c => c.charCodeAt(0)).buffer;
}

async function แยกแยะรหัสลับ(บัฟเฟอร์) {
  const มุมมองข้อมูล = new DataView(บัฟเฟอร์), ข้อมูลไบต์ = new Uint8Array(บัฟเฟอร์);
  const ตำแหน่งข้อมูล = ข้อมูลไบต์[17];
  const ตำแหน่งพอร์ต = 18 + ตำแหน่งข้อมูล + 1;
  const พอร์ตเป้าหมาย = มุมมองข้อมูล.getUint16(ตำแหน่งพอร์ต);
  if (พอร์ตเป้าหมาย === 53) throw new Error('ปฏิเสธการเชื่อมต่อ DNS');
  const ตำแหน่งที่อยู่ = ตำแหน่งพอร์ต + 2;
  let ประเภทที่อยู่ = ข้อมูลไบต์[ตำแหน่งที่อยู่];
  let ตำแหน่งข้อมูลที่อยู่ = ตำแหน่งที่อยู่ + 1;
  let ที่อยู่เป้าหมาย;
  let ความยาวที่อยู่;

  switch (ประเภทที่อยู่) {
    case 1: // IPv4
      ความยาวที่อยู่ = 4;
      ที่อยู่เป้าหมาย = Array.from(ข้อมูลไบต์.slice(ตำแหน่งข้อมูลที่อยู่, ตำแหน่งข้อมูลที่อยู่ + ความยาวที่อยู่)).join('.');
      break;
    case 2: // โดเมน
      ความยาวที่อยู่ = ข้อมูลไบต์[ตำแหน่งข้อมูลที่อยู่];
      ตำแหน่งข้อมูลที่อยู่ += 1;
      const โดเมน = new TextDecoder().decode(ข้อมูลไบต์.slice(ตำแหน่งข้อมูลที่อยู่, ตำแหน่งข้อมูลที่อยู่ + ความยาวที่อยู่));
      ที่อยู่เป้าหมาย = await หารังที่เร็วที่สุด(โดเมน);
      if (ที่อยู่เป้าหมาย !== โดเมน) {
        ประเภทที่อยู่ = ที่อยู่เป้าหมาย.includes(':') ? 3 : 1;
      }
      break;
    case 3: // IPv6
      ความยาวที่อยู่ = 16;
      const ipv6 = [];
      const มุมมองipv6 = new DataView(บัฟเฟอร์, ตำแหน่งข้อมูลที่อยู่, 16);
      for (let i = 0; i < 8; i++) ipv6.push(มุมมองipv6.getUint16(i * 2).toString(16));
      ที่อยู่เป้าหมาย = ipv6.join(':');
      break;
    default:
      throw new Error('ประเภทที่อยู่เป้าหมายไม่ถูกต้อง');
  }

  const ข้อมูลเริ่มต้น = บัฟเฟอร์.slice(ตำแหน่งข้อมูลที่อยู่ + ความยาวที่อยู่);
  let การเชื่อมต่อ;

  if (เปิดใช้รังสายลับ) {
    if (สายลับทั้งหมด) {
      การเชื่อมต่อ = await สร้างการเชื่อมต่อสายลับ(ประเภทที่อยู่, ที่อยู่เป้าหมาย, พอร์ตเป้าหมาย);
    } else {
      try {
        การเชื่อมต่อ = connect({ hostname: ที่อยู่เป้าหมาย, port: พอร์ตเป้าหมาย });
        await การเชื่อมต่อ.opened;
      } catch (e) {
        console.warn(`การเชื่อมต่อตรงไปที่ ${ที่อยู่เป้าหมาย}:${พอร์ตเป้าหมาย} ล้มเหลว, ลองใช้สายลับ: ${e.message}`);
        การเชื่อมต่อ = await สร้างการเชื่อมต่อสายลับ(ประเภทที่อยู่, ที่อยู่เป้าหมาย, พอร์ตเป้าหมาย);
      }
    }
  } else {
    การเชื่อมต่อ = connect({ hostname: ที่อยู่เป้าหมาย, port: พอร์ตเป้าหมาย });
  }

  await การเชื่อมต่อ.opened;
  return { tcpSocket: การเชื่อมต่อ, ข้อมูลเริ่มต้น };
}

async function สร้างการเชื่อมต่อสายลับ(ประเภทที่อยู่, ที่อยู่เป้าหมาย, พอร์ตเป้าหมาย) {
  let สายลับที่จะลอง = [];

  if (กลุ่มสายลับ.length > 0) {
    สายลับที่จะลอง = [...กลุ่มสายลับ];
  }

  if (สายลับที่จะลอง.length === 0 && รังสายลับสำรอง) {
    สายลับที่จะลอง.push(รังสายลับสำรอง);
  }

  if (สายลับที่จะลอง.length === 0) {
    throw new Error('ไม่ได้ตั้งค่ารังสายลับไว้ (รายชื่อสายลับหรือรังสายลับสำรอง)');
  }

  const คำสัญญาการเชื่อมต่อ = สายลับที่จะลอง.map(async (การตั้งค่าสายลับ, ดัชนี) => {
    let การเชื่อมต่อ = null;
    try {
      const { ชื่อ, รหัส, รัง, พอร์ต } = แยกแยะที่อยู่สายลับ(การตั้งค่าสายลับ);
      console.log(`กำลังพยายามเชื่อมต่อสายลับ: ${ชื่อ ? 'พร้อมรหัส' : 'ไม่มีรหัส'} ${รัง}:${พอร์ต} (สายลับ ${ดัชนี + 1}/${สายลับที่จะลอง.length})`);

      const คำสัญญาหมดเวลา = new Promise((resolve, reject) => {
        const id = setTimeout(() => {
          reject(new Error(`การเชื่อมต่อหมดเวลา: ${รัง}:${พอร์ต}`));
        }, เวลาเชื่อมต่อสายลับ);
      });

      การเชื่อมต่อ = await Promise.race([
        สร้างการเชื่อมต่อสายลับจริง(ชื่อ, รหัส, รัง, พอร์ต, ประเภทที่อยู่, ที่อยู่เป้าหมาย, พอร์ตเป้าหมาย),
        คำสัญญาหมดเวลา
      ]);

      console.log(`เชื่อมต่อกับสายลับสำเร็จ: ${รัง}:${พอร์ต}`);
      return { socket: การเชื่อมต่อ, config: การตั้งค่าสายลับ };
    } catch (e) {
      console.warn(`การเชื่อมต่อสายลับล้มเหลวหรือหมดเวลา (${การตั้งค่าสายลับ}): ${e.message}`);
      if (การเชื่อมต่อ) {
        try { การเชื่อมต่อ.close(); } catch (closeErr) { console.warn("ข้อผิดพลาดในการปิดการเชื่อมต่อที่ล้มเหลว:", closeErr); }
      }
      return Promise.reject(new Error(`สายลับล้มเหลว: ${การตั้งค่าสายลับ} - ${e.message}`));
    }
  });

  try {
    const { socket } = await Promise.any(คำสัญญาการเชื่อมต่อ);
    return socket;
  } catch (errorรวม) {
    console.error(`ความพยายามเชื่อมต่อสายลับทั้งหมดล้มเหลว:`, errorรวม.errors.map(e => e.message).join('; '));
    throw new Error('ความพยายามเชื่อมต่อสายลับทั้งหมดล้มเหลว');
  }
}

async function สร้างการเชื่อมต่อสายลับจริง(ชื่อ, รหัส, รัง, พอร์ต, ประเภทที่อยู่, ที่อยู่เป้าหมาย, พอร์ตเป้าหมาย) {
  const สายลับซอกเก็ต = connect({ hostname: รัง, port: พอร์ต });
  let writer, reader;
  try {
    await สายลับซอกเก็ต.opened;
    writer = สายลับซอกเก็ต.writable.getWriter();
    reader = สายลับซอกเก็ต.readable.getReader();
    const encoder = new TextEncoder();

    // SOCKS5 การเจรจา
    const วิธีการตรวจสอบ = new Uint8Array([5, 2, 0, 2]);
    await writer.write(วิธีการตรวจสอบ);
    const การตอบกลับ = (await reader.read()).value;

    if (!การตอบกลับ || การตอบกลับ.length < 2) {
      throw new Error('การตอบกลับการเจรจา SOCKS5 ไม่ถูกต้อง');
    }

    if (การตอบกลับ[1] === 0x02) {
      if (!ชื่อ || !รหัส) {
        throw new Error(`สายลับ SOCKS5 ต้องการการยืนยันตัวตน แต่ไม่ได้ตั้งค่าไว้`);
      }
      const แพ็คเก็ตการตรวจสอบ = new Uint8Array([1, ชื่อ.length, ...encoder.encode(ชื่อ), รหัส.length, ...encoder.encode(รหัส)]);
      await writer.write(แพ็คเก็ตการตรวจสอบ);
      const ผลลัพธ์การตรวจสอบ = (await reader.read()).value;
      if (!ผลลัพธ์การตรวจสอบ || ผลลัพธ์การตรวจสอบ.length < 2 || ผลลัพธ์การตรวจสอบ[0] !== 0x01 || ผลลัพธ์การตรวจสอบ[1] !== 0x00) {
        throw new Error(`รหัส SOCKS5/รหัสผ่านไม่ถูกต้องหรือการตรวจสอบล้มเหลว`);
      }
    } else if (การตอบกลับ[1] === 0x00) {
      // ไม่ต้องการการตรวจสอบ
    } else {
      throw new Error(`ไม่รองรับวิธีการตรวจสอบ SOCKS5: ${การตอบกลับ[1]}`);
    }

    // SOCKS5 เชื่อมต่อไปยังเป้าหมาย
    let ไบต์ที่อยู่เป้าหมาย;
    switch (ประเภทที่อยู่) {
      case 1: // IPv4
        ไบต์ที่อยู่เป้าหมาย = new Uint8Array([1, ...ที่อยู่เป้าหมาย.split('.').map(Number)]);
        break;
      case 2: // โดเมน
        ไบต์ที่อยู่เป้าหมาย = new Uint8Array([3, ที่อยู่เป้าหมาย.length, ...encoder.encode(ที่อยู่เป้าหมาย)]);
        break;
      case 3: // IPv6
        const ส่วนของipv6 = ที่อยู่เป้าหมาย.split(':');
        const ไบต์ipv6 = [];
        let จัดการเครื่องหมาย :: แล้ว = false;
        for (let i = 0; i < ส่วนของipv6.length; i++) {
          let part = ส่วนของipv6[i];
          if (part === '') {
            if (!จัดการเครื่องหมาย :: แล้ว) {
              let จำนวนส่วนที่หายไป = 8 - (ส่วนของipv6.length - 1);
              if (ส่วนของipv6[0] === '' && i === 0) จำนวนส่วนที่หายไป++;
              if (ส่วนของipv6[ส่วนของipv6.length - 1] === '' && i === ส่วนของipv6.length - 1) จำนวนส่วนที่หายไป++;
              for (let j = 0; j < จำนวนส่วนที่หายไป; j++) {
                ไบต์ipv6.push(0x00, 0x00);
              }
              จัดการเครื่องหมาย :: แล้ว = true;
            }
          } else {
            let val = parseInt(part, 16);
            ไบต์ipv6.push((val >> 8) & 0xFF, val & 0xFF);
          }
        }
        while (ไบต์ipv6.length < 16) {
            ไบต์ipv6.push(0x00, 0x00);
        }
        ไบต์ที่อยู่เป้าหมาย = new Uint8Array([4, ...ไบต์ipv6]);
        break;
      default:
        throw new Error('ประเภทที่อยู่เป้าหมาย SOCKS5 ไม่ถูกต้อง');
    }

    const แพ็คเก็ตเชื่อมต่อ = new Uint8Array([5, 1, 0, ...ไบต์ที่อยู่เป้าหมาย, พอร์ตเป้าหมาย >> 8, พอร์ตเป้าหมาย & 0xff]);
    await writer.write(แพ็คเก็ตเชื่อมต่อ);
    const การตอบกลับการเชื่อมต่อ = (await reader.read()).value;

    if (!การตอบกลับการเชื่อมต่อ || การตอบกลับการเชื่อมต่อ.length < 2 || การตอบกลับการเชื่อมต่อ[0] !== 0x05 || การตอบกลับการเชื่อมต่อ[1] !== 0x00) {
      throw new Error(`การเชื่อมต่อเป้าหมาย SOCKS5 ล้มเหลว เป้าหมาย: ${ที่อยู่เป้าหมาย}:${พอร์ตเป้าหมาย}, รหัสตอบกลับ SOCKS5: ${การตอบกลับการเชื่อมต่อ ? การตอบกลับการเชื่อมต่อ[1] : 'ไม่มีการตอบกลับ'}`);
    }

    writer.releaseLock();
    reader.releaseLock();
    return สายลับซอกเก็ต;
  } catch (e) {
    if (writer) writer.releaseLock();
    if (reader) reader.releaseLock();
    if (สายลับซอกเก็ต) สายลับซอกเก็ต.close();
    throw e;
  }
}

async function ส่งข้อมูล(ws, tcp, ข้อมูลเริ่มต้น) {
  // ส่งการตอบกลับการเชื่อมต่อลับ
  ws.send(new Uint8Array([0, 0]));

  const writer = tcp.writable.getWriter();
  const reader = tcp.readable.getReader();

  // เขียนข้อมูลเริ่มต้นจากลูกค้า
  if (ข้อมูลเริ่มต้น && ข้อมูลเริ่มต้น.byteLength > 0) {
    await writer.write(ข้อมูลเริ่มต้น).catch(err => console.error("เขียนข้อมูลเริ่มต้นไปยัง TCP ล้มเหลว:", err));
  }

  // การถ่ายโอนข้อมูลจาก WebSocket ไปยัง TCP
  ws.addEventListener('message', async e => {
    if (e.data instanceof ArrayBuffer) {
      try {
        await writer.write(e.data);
      } catch (err) {
        console.error("เขียนจาก WebSocket ไปยัง TCP ล้มเหลว:", err);
      }
    } else {
      console.warn("ได้รับข้อมูลที่ไม่ใช่ ArrayBuffer (WebSocket):", e.data);
    }
  });

  // การถ่ายโอนข้อมูลจาก TCP ไปยัง WebSocket
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        try {
          ws.send(value);
        } catch (sendErr) {
          console.error("ส่งข้อมูลจาก TCP ไปยัง WebSocket ล้มเหลว:", sendErr);
          break;
        }
      }
    }
  } catch (readErr) {
    console.error("อ่านข้อมูลจาก TCP ล้มเหลว:", readErr);
  } finally {
    try { ws.close(); } catch (e) { console.warn("ปิด WebSocket ล้มเหลว:", e); }
    try { reader.cancel(); } catch (e) { console.warn("ยกเลิกการอ่าน TCP ล้มเหลว:", e); }
    try { writer.releaseLock(); } catch (e) { console.warn("ปล่อยล็อคการเขียน TCP ล้มเหลว:", e); }
    try { tcp.close(); } catch (e) { console.warn("ปิดการเชื่อมต่อ TCP ล้มเหลว:", e); }
    console.log("ท่อการถ่ายโอนปิดแล้ว");
  }
}

function รับรหัสลับใหญ่(อาร์เรย์) {
  const hex = Array.from(อาร์เรย์, v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function หารังที่เร็วที่สุด(โดเมน) {
  const สร้างคำขอติดต่อ = (ประเภท) =>
    จุดติดต่อสายลับ.map(url =>
      fetch(`${url}?name=${โดเมน}&type=${ประเภท}`, {
        headers: { 'Accept': 'application/dns-json' }
      }).then(res => res.json())
        .then(json => {
          const ที่อยู่ = json.Answer?.find(r => r.type === (ประเภท === 'A' ? 1 : 28))?.data;
          if (ที่อยู่) return ที่อยู่;
          return Promise.reject(`ไม่มีบันทึก ${ประเภท}`);
        })
        .catch(err => Promise.reject(`${url} ${ประเภท} คำขอล้มเหลว: ${err}`))
    );
  try {
    return await Promise.any(สร้างคำขอติดต่อ('A'));
  } catch (e) {
    try {
      return await Promise.any(สร้างคำขอติดต่อ('AAAA'));
    } catch (e2) {
      console.warn(`คำขอ DOH สำหรับ ${โดเมน} ล้มเหลว (ทั้ง IPv4 และ IPv6): ${e2.message}`);
      return โดเมน;
    }
  }
}

function แยกแยะที่อยู่สายลับ(สตริงที่อยู่) {
  const atIndex = สตริงที่อยู่.lastIndexOf("@");
  if (atIndex === -1) {
    const [รัง, พอร์ต] = แยกแยะรังและพอร์ต(สตริงที่อยู่);
    return { ชื่อ: '', รหัส: '', รัง, พอร์ต };
  }
  const ส่วนการตรวจสอบ = สตริงที่อยู่.slice(0, atIndex);
  const ส่วนของรัง = สตริงที่อยู่.slice(atIndex + 1);
  const โคลอนสุดท้ายในส่วนการตรวจสอบ = ส่วนการตรวจสอบ.lastIndexOf(":");
  const ชื่อ = โคลอนสุดท้ายในส่วนการตรวจสอบ > -1 ? ส่วนการตรวจสอบ.slice(0, โคลอนสุดท้ายในส่วนการตรวจสอบ) : '';
  const รหัส = โคลอนสุดท้ายในส่วนการตรวจสอบ > -1 ? ส่วนการตรวจสอบ.slice(โคลอนสุดท้ายในส่วนการตรวจสอบ + 1) : '';
  const [รัง, พอร์ต] = แยกแยะรังและพอร์ต(ส่วนของรัง);
  return { ชื่อ, รหัส, รัง, พอร์ต };
}

function แยกแยะรังและพอร์ต(ส่วนของรัง) {
  let รัง, พอร์ต;
  if (ส่วนของรัง.startsWith('[')) {
    const วงเล็บปิด = ส่วนของรัง.indexOf(']');
    if (วงเล็บปิด === -1) throw new Error('รูปแบบที่อยู่ IPv6 ไม่ถูกต้อง');
    รัง = ส่วนของรัง.slice(1, วงเล็บปิด);
    const สตริงพอร์ต = ส่วนของรัง.slice(วงเล็บปิด + 1);
    พอร์ต = สตริงพอร์ต.startsWith(':') ? Number(สตริงพอร์ต.slice(1)) : 443;
    if (isNaN(พอร์ต) || พอร์ต <= 0 || พอร์ต > 65535) พอร์ต = 443;
  } else {
    const โคลอนสุดท้าย = ส่วนของรัง.lastIndexOf(':');
    if (โคลอนสุดท้าย > -1 && !isNaN(Number(ส่วนของรัง.slice(โคลอนสุดท้าย + 1)))) {
      รัง = ส่วนของรัง.slice(0, โคลอนสุดท้าย);
      พอร์ต = Number(ส่วนของรัง.slice(โคลอนสุดท้าย + 1));
    } else {
      รัง = ส่วนของรัง;
      พอร์ต = 443;
    }
  }
  return [รัง, พอร์ต];
}

function สร้างหน้าแผนที่(id, host) {
  return `
1.ฟังก์ชันของวิเศษของ worker นี้รองรับเฉพาะการสมัครใช้งานทั่วไปเท่านั้น โปรดปิดฟังก์ชันของวิเศษสำหรับคนอื่น
2.ความต้องการอื่นๆ โปรดศึกษาด้วยตนเอง
สำหรับลูกค้าทั่วไป: https${คำสั่งเชื่อมต่อ}${host}/${id}/${รหัสเส้นทาง}${รหัสส่วนท้าย}
`;
}

function สร้างไฟล์การตั้งค่า(host) {
  const รังที่ชอบของข้าว่างเปล่า = รังลับที่ชอบ.length === 0 || (รังลับที่ชอบ.length === 1 && รังลับที่ชอบ[0] === '');
  const รายชื่อที่ชอบของข้าว่างเปล่า = รายชื่อรังลับที่ชอบ.length === 0 || (รายชื่อรังลับที่ชอบ.length === 1 && รายชื่อรังลับที่ชอบ[0] === '');
  const รังลับที่ใช้ได้จริง = (!รังที่ชอบของข้าว่างเปล่า || !รายชื่อที่ชอบของข้าว่างเปล่า) ? รังลับที่ชอบ : [`${host}:443#รังสำรอง`];

  if (เปิดใช้ของวิเศษ) {
    return `โปรดปิดฟังก์ชันของวิเศษก่อน`;
  } else {
    return รังลับที่ใช้ได้จริง.map(item => {
      const parts = item.split("@");
      let mainPart = parts[0];
      let tlsOption = 'security=tls';

      if (parts.length > 1) {
          const tlsConfig = parts[1];
          if (tlsConfig.toLowerCase() === 'notls') {
              tlsOption = 'security=none';
          }
      }

      const [addrPort, name = ชื่อรังของข้า] = mainPart.split("#");
      const addrParts = addrPort.split(":");
      const port = addrParts.length > 1 && !isNaN(Number(addrParts[addrParts.length - 1])) ? Number(addrParts.pop()) : 443;
      const addr = addrParts.join(":");

      return `${รหัสเส้นทาง}${รหัสส่วนท้าย}${คำสั่งเชื่อมต่อ}${รหัสลับใหญ่}@${addr}:${port}?encryption=none&${tlsOption}&sni=${host}&type=ws&host=${host}&path=%2F%3Ded%3D2560#${name}`;
    }).join("\n");
  }
			}
