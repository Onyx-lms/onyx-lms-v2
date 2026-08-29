/**
 * Turns apps/web/public/onyx-mark.png into the constant `format/pdf-mark.ts`
 * that `pdfCertificate` draws.
 *
 * WHY A GENERATED CONSTANT RATHER THAN READING THE PNG AT RUNTIME. The file
 * lives in the Next app's `public/`, and packages/core is a library that is
 * bundled into serverless functions where that directory is not on disk. A
 * `readFileSync` would work in development and 500 in production, which is the
 * worst of the available failures. So the bytes are compiled in.
 *
 * WHY IT IS SO SMALL. The source is a 235x117 RGBA PNG of 37KB, which is
 * mostly gradient noise in the anti-aliased fringe and a full alpha channel.
 * A certificate is white paper, so the alpha is composited onto white here and
 * thrown away -- that removes the need for an /SMask object entirely -- and
 * the result is reduced to a 64-colour palette by median cut. A two-tone mark
 * survives 64 colours without visible banding, and an /Indexed image of a flat
 * palette deflates to about 6KB.
 *
 *   node tools/onyx/build-pdf-mark.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const SOURCE = 'apps/web/public/onyx-mark.png';
const TARGET = 'packages/core/src/format/pdf-mark.ts';
const COLOURS = 64;

/** Decode a non-interlaced, 8-bit PNG to flat pixel bytes. */
function decodePng(file) {
  const d = readFileSync(file);
  if (d.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = d.readUInt32BE(16);
  const height = d.readUInt32BE(20);
  const depth = d[24];
  const colour = d[25];
  const interlace = d[28];
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
    throw new Error('expected an 8-bit, non-interlaced RGB or RGBA PNG');
  }
  const channels = colour === 6 ? 4 : 3;

  let idat = [];
  for (let i = 8; i < d.length;) {
    const len = d.readUInt32BE(i);
    const type = d.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') idat.push(d.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));

  // Undo the per-scanline filters. Five of them, defined by the PNG spec in
  // terms of the byte to the left (a), above (b) and above-left (c).
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0, p = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a); const pb = Math.abs(q - b); const pc = Math.abs(q - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { width, height, channels, pixels: out };
}

/** Median cut: split the colour box on its longest axis until there are n. */
function palette(pixels, n) {
  let boxes = [pixels];
  while (boxes.length < n) {
    boxes.sort((x, y) => spread(x) * x.length - spread(y) * y.length);
    const big = boxes.pop();
    if (big.length < 2) { boxes.unshift(big); break; }
    const axis = longest(big);
    big.sort((p, q) => p[axis] - q[axis]);
    const half = big.length >> 1;
    boxes.push(big.slice(0, half), big.slice(half));
  }
  return boxes.filter((b) => b.length).map((b) => [0, 1, 2].map((c) =>
    Math.round(b.reduce((sum, p) => sum + p[c], 0) / b.length)));
}
const extent = (box, c) => {
  let lo = 255; let hi = 0;
  for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
  return hi - lo;
};
const spread = (box) => Math.max(extent(box, 0), extent(box, 1), extent(box, 2));
const longest = (box) => [0, 1, 2].reduce((best, c) =>
  extent(box, c) > extent(box, best) ? c : best, 0);

const { width, height, channels, pixels } = decodePng(SOURCE);

// Composite onto white. Everything downstream then treats the mark as opaque.
const flat = [];
for (let i = 0; i < pixels.length; i += channels) {
  const a = channels === 4 ? pixels[i + 3] / 255 : 1;
  flat.push([0, 1, 2].map((c) => Math.round(pixels[i + c] * a + 255 * (1 - a))));
}

const pal = palette(flat.slice(), COLOURS);
const nearest = new Map();
const indices = Buffer.alloc(flat.length);
flat.forEach((p, i) => {
  const key = (p[0] << 16) | (p[1] << 8) | p[2];
  let hit = nearest.get(key);
  if (hit === undefined) {
    let best = 0; let bestD = Infinity;
    pal.forEach((q, j) => {
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    });
    hit = best;
    nearest.set(key, hit);
  }
  indices[i] = hit;
});

const data = deflateSync(indices, { level: 9 });
const table = deflateSync(Buffer.from(pal.flat()), { level: 9 });

writeFileSync(TARGET, `/**
 * The Onyx mark, as the bytes a PDF image XObject wants.
 *
 * GENERATED by tools/onyx/build-pdf-mark.mjs from apps/web/public/onyx-mark.png.
 * Do not edit by hand -- change the PNG and run the tool.
 *
 * An /Indexed image over ${pal.length} colours, composited onto white so it needs
 * no soft mask, both streams already /FlateDecode. See the tool's header for
 * why the bytes are compiled in rather than read from disk.
 */
export const ONYX_MARK = {
  width: ${width},
  height: ${height},
  /** Palette entries, so /Indexed knows its hival is this minus one. */
  colours: ${pal.length},
  /** Deflated ${pal.length}x3 RGB palette. */
  palette: '${table.toString('base64')}',
  /** Deflated one-byte-per-pixel palette indices, top row first. */
  data: '${data.toString('base64')}',
} as const;
`);

console.log('wrote ' + TARGET);
console.log('  ' + width + 'x' + height + ', ' + pal.length + ' colours');
console.log('  palette ' + table.length + 'B, data ' + data.length + 'B'
  + ' (' + Math.round((table.length + data.length) * 4 / 3 / 102.4) / 10 + 'KB base64)');
