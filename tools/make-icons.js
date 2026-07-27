'use strict';

/**
 * Erzeugt die App-Symbole als PNG – ohne Bildbibliothek, nur mit
 * Node-Bordmitteln (zlib für die Bilddaten, CRC32 für die Blöcke).
 *
 * Aufruf:  node tools/make-icons.js
 * Nur nötig, wenn sich das Symbol ändern soll; die fertigen Dateien
 * liegen unter icons/ im Repository.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');

/* ---------- PNG schreiben ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {Uint8Array} rgba  Länge = width*height*4 */
function encodePng(rgba, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;    // 8 Bit je Kanal
  header[9] = 6;    // RGBA
  header[10] = 0;   // Deflate
  header[11] = 0;   // Standardfilter
  header[12] = 0;   // kein Interlacing

  // Jede Zeile bekommt ein führendes Filterbyte (0 = keiner).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Symbol zeichnen ---------- */

/**
 * Zeichnet einen Berg mit Wanderweg auf grünem Grund.
 * @param {number} size Kantenlänge
 * @param {boolean} maskable  Für maskierbare Symbole bleibt außen Luft,
 *                            weil Android runde Ausschnitte anwendet.
 */
function drawIcon(size, maskable) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b], alpha = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // Über vorhandene Farbe mischen, damit Kanten weich wirken.
    const a = alpha / 255;
    px[i] = px[i] * (1 - a) + r * a;
    px[i + 1] = px[i + 1] * (1 - a) + g * a;
    px[i + 2] = px[i + 2] * (1 - a) + b * a;
    px[i + 3] = 255;
  };

  const GREEN = [47, 107, 63];
  const DARK = [36, 82, 47];
  const SNOW = [244, 245, 242];
  const ROCK = [70, 78, 68];
  const PATH = [222, 196, 120];

  // Hintergrund
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) set(x, y, GREEN);
  }

  // Bei maskierbaren Symbolen den Inhalt auf 60 % der Fläche zentrieren.
  const inset = maskable ? size * 0.2 : size * 0.08;
  const w = size - inset * 2;
  const toX = (u) => inset + u * w;
  const toY = (v) => inset + v * w;

  // Himmel als etwas dunklerer Block hinter dem Berg
  for (let y = Math.round(toY(0)); y < Math.round(toY(1)); y++) {
    for (let x = Math.round(toX(0)); x < Math.round(toX(1)); x++) {
      set(x, y, DARK);
    }
  }

  // Bergsilhouette: zwei Dreiecke
  const peaks = [
    { apex: [0.38, 0.18], left: [0.02, 0.86], right: [0.72, 0.86] },
    { apex: [0.72, 0.34], left: [0.42, 0.86], right: [0.98, 0.86] },
  ];
  for (const peak of peaks) {
    const ax = toX(peak.apex[0]), ay = toY(peak.apex[1]);
    const lx = toX(peak.left[0]), ly = toY(peak.left[1]);
    const rx = toX(peak.right[0]), ry = toY(peak.right[1]);

    for (let y = Math.floor(ay); y <= Math.ceil(ly); y++) {
      const t = (y - ay) / (ly - ay || 1);
      const xa = ax + (lx - ax) * t;
      const xb = ax + (rx - ax) * t;
      for (let x = Math.floor(xa); x <= Math.ceil(xb); x++) {
        // Schneekappe im oberen Fünftel
        const snowLine = ay + (ly - ay) * 0.22;
        set(x, y, y < snowLine ? SNOW : ROCK);
      }
    }
  }

  // Wanderweg als heller Zickzack über den vorderen Berg
  const pathPoints = [
    [0.30, 0.86], [0.42, 0.74], [0.32, 0.62], [0.44, 0.50], [0.38, 0.38],
  ];
  const thickness = Math.max(2, size * 0.035);
  for (let i = 1; i < pathPoints.length; i++) {
    const x1 = toX(pathPoints[i - 1][0]), y1 = toY(pathPoints[i - 1][1]);
    const x2 = toX(pathPoints[i][0]), y2 = toY(pathPoints[i][1]);
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
    for (let s = 0; s <= steps; s++) {
      const cx = x1 + ((x2 - x1) * s) / steps;
      const cy = y1 + ((y2 - y1) * s) / steps;
      for (let dy = -thickness; dy <= thickness; dy++) {
        for (let dx = -thickness; dx <= thickness; dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= thickness) {
            set(Math.round(cx + dx), Math.round(cy + dy), PATH,
                d > thickness - 1 ? 120 : 255);
          }
        }
      }
    }
  }

  return px;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const { file, size, maskable } of targets) {
  const png = encodePng(drawIcon(size, maskable), size, size);
  fs.writeFileSync(path.join(OUT_DIR, file), png);
  console.log(`${file} (${size}×${size}, ${(png.length / 1024).toFixed(1)} kB)`);
}
