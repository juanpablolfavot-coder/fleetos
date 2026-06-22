// Genera los íconos PWA (PNG) sin dependencias: encoding PNG directo + zlib.
// Diseño: camión blanco sobre fondo azul de marca (#2563eb). Full-bleed para
// que quede bien como ícono "maskable" (Android recorta a círculo/rounded).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makePNG(size, draw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, color type 2 (RGB)
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filtro: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x / size, y / size);
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BLUE = [0x25, 0x63, 0xeb], NAVY = [0x17, 0x3a, 0xa8], WHITE = [0xff, 0xff, 0xff];
function draw(u, v) {
  let c = BLUE;
  const rect = (x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
  const circ = (cx, cy, r) => { const dx = u - cx, dy = v - cy; return dx * dx + dy * dy <= r * r; };
  if (rect(0.18, 0.31, 0.60, 0.58)) c = WHITE;            // carrocería
  if (rect(0.60, 0.40, 0.81, 0.58)) c = WHITE;            // cabina
  if (rect(0.635, 0.435, 0.785, 0.515)) c = BLUE;         // ventana
  if (rect(0.18, 0.58, 0.81, 0.605)) c = NAVY;            // chasis
  if (circ(0.32, 0.645, 0.072)) c = NAVY;                 // rueda izq
  if (circ(0.69, 0.645, 0.072)) c = NAVY;                 // rueda der
  if (circ(0.32, 0.645, 0.028)) c = WHITE;
  if (circ(0.69, 0.645, 0.028)) c = WHITE;
  return c;
}

const out = path.join(__dirname, '..', 'public');
for (const [name, size] of [
  ['icon-192.png', 192], ['icon-512.png', 512],
  ['apple-touch-icon.png', 180], ['icon-32.png', 32],
]) {
  fs.writeFileSync(path.join(out, name), makePNG(size, draw));
  console.log('✓', name, size + 'x' + size);
}
