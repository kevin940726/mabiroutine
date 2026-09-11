// Generator: iOS apple-touch-startup-image PNGs in public/splash/.
// Pure Node (zlib only): decodes public/icon-512.png (8-bit RGBA,
// non-interlaced), centers it on a solid bg, writes one PNG per device size
// x color scheme. Rerun (node scripts/gen-splash.cjs, from repo root) if the
// icon or bg ever changes — output is deterministic.
// Unlike the data fetchers (gitignored, private-local), this is committed
// build tooling: the PNGs are our own assets and must stay regenerable.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SRC = "public/icon-512.png";
const OUT = "public/splash";
const LIGHT = [255, 255, 255];
const DARK = [16, 16, 18]; // matches the in-app boot splash

// [file-stem, px W, px H, css W, css H, pixel ratio]
const SIZES = [
  ["1320x2868", 1320, 2868, 440, 956, 3],
  ["1290x2796", 1290, 2796, 390, 844, 3],
  ["1206x2622", 1206, 2622, 402, 874, 3],
  ["1179x2556", 1179, 2556, 393, 852, 3],
  ["1284x2778", 1284, 2778, 428, 926, 3],
  ["1170x2532", 1170, 2532, 390, 844, 3],
  ["1125x2436", 1125, 2436, 375, 812, 3],
  ["1260x2736", 1260, 2736, 420, 912, 3], // iPhone Air
  ["1242x2688", 1242, 2688, 414, 896, 3],
  ["828x1792", 828, 1792, 414, 896, 2],
  ["750x1334", 750, 1334, 375, 667, 2],
  ["640x1136", 640, 1136, 320, 568, 2],
  ["2048x2732", 2048, 2732, 1024, 1366, 2],
  ["2064x2752", 2064, 2752, 1032, 1376, 2], // iPad Pro 13" M4
  ["1668x2420", 1668, 2420, 834, 1210, 2], // iPad Pro 11" M4
  ["1668x2388", 1668, 2388, 834, 1194, 2],
  ["1640x2360", 1640, 2360, 820, 1180, 2],
  ["1488x2266", 1488, 2266, 744, 1133, 2],
  ["1536x2048", 1536, 2048, 768, 1024, 2],
];

function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function decodePng(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const depth = b[24];
  const ctype = b[25];
  if (depth !== 8 || ctype !== 6 || b[28] !== 0)
    throw new Error(
      `unexpected icon format depth=${depth} ctype=${ctype} — re-export ${SRC} as 8-bit RGBA, non-interlaced`
    );
  const idat = [];
  let o = 8;
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString("ascii", o + 4, o + 8);
    if (type === "IDAT") idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = 4;
  const stride = w * ch;
  const px = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const bb = y > 0 ? px[(y - 1) * stride + x] : 0;
      const cc = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = raw[p++];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + bb) & 0xff;
      else if (f === 3) v = (v + ((a + bb) >> 1)) & 0xff;
      else if (f === 4) {
        const pa = Math.abs(bb - cc);
        const pb = Math.abs(a - cc);
        const pc = Math.abs(a + bb - 2 * cc);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? bb : cc;
        v = (v + pr) & 0xff;
      }
      px[y * stride + x] = v;
    }
  }
  return { w, h, px };
}

function scaleRgba(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      for (let c = 0; c < 4; c++) {
        const v =
          src[(y0 * sw + x0) * 4 + c] * (1 - fx) * (1 - fy) +
          src[(y0 * sw + x1) * 4 + c] * fx * (1 - fy) +
          src[(y1 * sw + x0) * 4 + c] * (1 - fx) * fy +
          src[(y1 * sw + x1) * 4 + c] * fx * fy;
        out[(y * dw + x) * 4 + c] = Math.round(v);
      }
    }
  }
  return out;
}

function encodeRgb(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const icon = decodePng(SRC);
fs.mkdirSync(OUT, { recursive: true });
for (const [stem, W, H] of SIZES) {
  const iconPx = Math.min(512, Math.round(Math.min(W, H) * 0.28));
  const scaled = scaleRgba(icon.px, icon.w, icon.h, iconPx, iconPx);
  for (const [scheme, bg] of [["light", LIGHT], ["dark", DARK]]) {
    const rgb = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      rgb[i * 3] = bg[0];
      rgb[i * 3 + 1] = bg[1];
      rgb[i * 3 + 2] = bg[2];
    }
    const ox = Math.round((W - iconPx) / 2);
    const oy = Math.round((H - iconPx) / 2);
    for (let y = 0; y < iconPx; y++) {
      for (let x = 0; x < iconPx; x++) {
        const a = scaled[(y * iconPx + x) * 4 + 3] / 255;
        const o = ((oy + y) * W + ox + x) * 3;
        for (let c = 0; c < 3; c++) {
          rgb[o + c] = Math.round(scaled[(y * iconPx + x) * 4 + c] * a + bg[c] * (1 - a));
        }
      }
    }
    const name = `splash-${stem}-${scheme}.png`;
    fs.writeFileSync(path.join(OUT, name), encodeRgb(W, H, rgb));
    console.log(name, fs.statSync(path.join(OUT, name)).size, "bytes");
  }
}
