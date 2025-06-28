function 验证VL的密钥(a) {
  const hex = Array.from(a, v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function 给我订阅页面(ID, host) {
  return `
1、本worker的私钥功能只支持通用订阅，其他请关闭私钥功能  
2、其他需求自行研究  
通用的：https${符号}${host}/${ID}/${转码}${转码2}
`;
}

function 给我通用配置文件(host) {
  我的优选.push(`${host}:443#测试节点`);
  if (私钥开关) return '请先关闭私钥功能';

  return 我的优选.map(item => {
    const [main, tls] = item.split("@");
    const [addrPort, name = 我的节点名字] = main.split("#");
    const parts = addrPort.split(":");
    const port = parts.length > 1 ? Number(parts.pop()) : 443;
    const addr = parts.join(":");
    const tlsOpt = tls === 'notls' ? 'security=none' : 'security=tls';
    return `${转码}${转码2}${符号}${哎呀呀这是我的VL密钥}@${addr}:${port}?encryption=none&${tlsOpt}&sni=${host}&type=ws&host=${host}&path=%2F%3Fed%3D2560#${name}`;
  }).join("\n");
}
