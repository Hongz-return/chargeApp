/**
 * 生成 tabBar 图标与地图 marker 图标（PNG）。
 *
 * 小程序 tabBar 只接受图片文件，为避免在仓库里塞入不可维护的二进制，
 * 这里用纯 Node（zlib）以矢量方式绘制并导出 PNG，图标改动只需改本文件后重跑：
 *
 *   node tools/gen-assets.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------ PNG 编码 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------- 形状与光栅化 */

const SS = 4; // 每轴超采样倍数，用于抗锯齿

function circle(cx, cy, r) {
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function ring(cx, cy, r, w) {
  const inner = circle(cx, cy, r - w);
  const outer = circle(cx, cy, r);
  return (x, y) => outer(x, y) && !inner(x, y);
}

function roundRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return dx * dx + dy * dy <= r * r;
  };
}

function capsule(x0, y0, x1, y1, r) {
  return (x, y) => {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((x - x0) * vx + (y - y0) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + t * vx;
    const py = y0 + t * vy;
    return (x - px) ** 2 + (y - py) ** 2 <= r * r;
  };
}

function polygon(points) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };
}

function union(...tests) {
  return (x, y) => tests.some((t) => t(x, y));
}

function subtract(base, ...holes) {
  return (x, y) => base(x, y) && !holes.some((t) => t(x, y));
}

function clipY(test, minY, maxY) {
  return (x, y) => y >= minY && y <= maxY && test(x, y);
}

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/**
 * 把若干图层（形状 + 颜色）光栅化为 RGBA buffer。
 * 图层按数组顺序自下而上叠加，坐标系固定为 100 x 100 的设计画布。
 */
function rasterize(size, layers) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const scale = 100 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      layers.forEach((layer) => {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const x = (px + (sx + 0.5) / SS) * scale;
            const y = (py + (sy + 0.5) / SS) * scale;
            if (layer.test(x, y)) hits++;
          }
        }
        if (!hits) return;
        const cov = (hits / (SS * SS)) * (layer.alpha === undefined ? 1 : layer.alpha);
        const [lr, lg, lb] = hexToRgb(layer.color);
        // source-over 合成
        const outA = cov + a * (1 - cov);
        if (outA <= 0) return;
        r = (lr * cov + r * a * (1 - cov)) / outA;
        g = (lg * cov + g * a * (1 - cov)) / outA;
        b = (lb * cov + b * a * (1 - cov)) / outA;
        a = outA;
      });
      const i = (py * size + px) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

/* ------------------------------------------------------------ 图标定义 */

const BOLT = polygon([
  [64, 4],
  [22, 57],
  [45, 57],
  [37, 96],
  [78, 43],
  [55, 43]
]);

const ORDER = union(
  subtract(roundRect(20, 10, 80, 90, 12), roundRect(28, 18, 72, 82, 7)),
  capsule(37, 36, 63, 36, 4),
  capsule(37, 51, 63, 51, 4),
  capsule(37, 66, 54, 66, 4)
);

const MINE = union(circle(50, 31, 17), clipY(circle(50, 96, 35), 58, 90));

const ICONS = {
  charge: BOLT,
  order: ORDER,
  mine: MINE
};

const INACTIVE = '#9aa0a6';
const ACTIVE = '#07c160';

function outFile(...parts) {
  const file = path.join(__dirname, '..', ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function writeIcon(name, test, color, size) {
  const file = outFile('assets', 'tabbar', `${name}.png`);
  fs.writeFileSync(file, encodePng(size, size, rasterize(size, [{ test, color }])));
  return file;
}

function main() {
  const written = [];
  Object.keys(ICONS).forEach((name) => {
    written.push(writeIcon(name, ICONS[name], INACTIVE, 81));
    written.push(writeIcon(`${name}-active`, ICONS[name], ACTIVE, 81));
  });

  // 地图 marker：绿色水滴 + 白色闪电
  const pinBody = union(circle(50, 40, 32), polygon([[24, 60], [76, 60], [50, 96]]));
  const pinBolt = polygon([
    [56, 18],
    [36, 44],
    [48, 44],
    [44, 62],
    [64, 36],
    [52, 36]
  ]);
  const markerFile = outFile('assets', 'marker', 'pin.png');
  fs.writeFileSync(
    markerFile,
    encodePng(
      64,
      64,
      rasterize(64, [
        { test: pinBody, color: '#07c160' },
        { test: pinBolt, color: '#ffffff' }
      ])
    )
  );
  written.push(markerFile);

  // 灰色 marker：用于展示无空闲枪的站点
  const grayFile = outFile('assets', 'marker', 'pin-gray.png');
  fs.writeFileSync(
    grayFile,
    encodePng(
      64,
      64,
      rasterize(64, [
        { test: pinBody, color: '#9aa0a6' },
        { test: pinBolt, color: '#ffffff' }
      ])
    )
  );
  written.push(grayFile);

  written.forEach((f) => console.log('generated', path.relative(path.join(__dirname, '..'), f)));
}

main();
