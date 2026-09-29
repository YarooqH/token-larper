import { deflateSync } from "node:zlib";
import { flattenPath, LOGO_PATHS } from "./client/logoMark.ts";

// PNG and ICO versions of the logo for places that can't use the SVG favicon: /favicon.ico
// (requested by some browsers and tools on their own) and the Apple touch icon. They are
// rasterized here from the same paths, so no image files or image libraries are needed.
// Both put the white mark on a dark tile, which reads on light and dark tab strips alike;
// iOS fills transparency with black anyway.

const INK = [0xf5, 0xf5, 0xf5] as const;
const TILE = [0x14, 0x14, 0x14] as const;
const SUPERSAMPLE = 4;

// The mark's polygons in 64-unit logo space. Filled even-odd, which also cuts out the flame's core.
const POLYGONS = [LOGO_PATHS.t, LOGO_PATHS.flame].flatMap((d) => flattenPath(d));

/** Fraction of each pixel covered, from SUPERSAMPLE² samples per pixel. */
function coverage(size: number, inside: (x: number, y: number) => boolean): Float32Array {
  const out = new Float32Array(size * size);
  const step = 1 / SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          if (inside(px + (sx + 0.5) * step, py + (sy + 0.5) * step)) hits++;
        }
      }
      out[py * size + px] = hits / (SUPERSAMPLE * SUPERSAMPLE);
    }
  }
  return out;
}

function insideMark(x: number, y: number): boolean {
  let inside = false;
  for (const polygon of POLYGONS) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]!;
      const [xj, yj] = polygon[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function insideRoundedSquare(x: number, y: number, size: number, radius: number): boolean {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/**
 * RGBA pixels: the mark centered at markScale of the icon, on a tile with the given
 * corner radius (as a fraction of the size; 0 for a full square).
 */
function renderIcon(size: number, markScale: number, cornerRadius: number): Uint8Array {
  const markSize = size * markScale;
  const offset = (size - markSize) / 2;
  const unit = 64 / markSize;
  const radius = size * cornerRadius;
  const tile = cornerRadius > 0 ? coverage(size, (x, y) => insideRoundedSquare(x, y, size, radius)) : null;
  const mark = coverage(size, (x, y) => insideMark((x - offset) * unit, (y - offset) * unit));
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const t = tile ? tile[i]! : 1;
    const m = Math.min(mark[i]!, t);
    // The mark over the tile, then the tile's own edge over transparency.
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(INK[c]! * m + TILE[c]! * (1 - m));
    rgba[i * 4 + 3] = Math.round(t * 255);
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(rows, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** An ICO file holding PNG images, which every browser since IE 9 and Windows Vista reads. */
function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); // planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

// At 16px the flame is a few pixels, so the mark fills more of the tile there.
const tilePng = (size: number) => encodePng(size, renderIcon(size, size <= 16 ? 0.9 : 0.78, size <= 16 ? 0.16 : 0.22));

let favicon: Uint8Array<ArrayBuffer> | null = null;
let touchIcon: Uint8Array<ArrayBuffer> | null = null;

export function faviconIco(): Uint8Array<ArrayBuffer> {
  return (favicon ??= new Uint8Array(encodeIco([16, 32, 48].map((size) => ({ size, png: tilePng(size) })))));
}

/** 180×180, full-bleed: iOS rounds the corners itself. */
export function appleTouchIconPng(): Uint8Array<ArrayBuffer> {
  return (touchIcon ??= new Uint8Array(encodePng(180, renderIcon(180, 0.62, 0))));
}
