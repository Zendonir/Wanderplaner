'use strict';

/**
 * Minimaler QR-Code-Encoder (Modell 2, Byte-Modus, Fehlerkorrektur-Level M,
 * Versionen 1–10). Bewusst ohne externe Bibliothek, damit die App auch ohne
 * CDN und offline funktioniert.
 *
 * Reicht für Karten-Links bis 213 Zeichen – deutlich mehr, als eine
 * Koordinaten-URL braucht.
 */
const QRCode = (function () {
  // Datenkapazität im Byte-Modus je Version bei Level M.
  const CAPACITY = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

  // Je Version: [ECC-Codewörter pro Block, Blöcke Gruppe 1, Datenwörter G1,
  //              Blöcke Gruppe 2, Datenwörter G2]
  const ECC_TABLE = [
    [10, 1, 16, 0, 0],   // 1
    [16, 1, 28, 0, 0],   // 2
    [26, 1, 44, 0, 0],   // 3
    [18, 2, 32, 0, 0],   // 4
    [24, 2, 43, 0, 0],   // 5
    [16, 4, 27, 0, 0],   // 6
    [18, 4, 31, 0, 0],   // 7
    [22, 2, 38, 2, 39],  // 8
    [22, 3, 36, 2, 37],  // 9
    [26, 4, 43, 1, 44],  // 10
  ];

  // Positionen der Ausrichtungsmuster je Version.
  const ALIGNMENT = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  ];

  // Formatinformation für Level M, Maske 0–7.
  const FORMAT_INFO = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  ];

  // Versionsinformation (erst ab Version 7 im Code enthalten).
  const VERSION_INFO = {
    7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3,
  };

  /* ---------- Galois-Feld GF(256) für Reed-Solomon ---------- */

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d; // Generatorpolynom des QR-Standards
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** Generatorpolynom für n Fehlerkorrektur-Codewörter. */
  function rsGenerator(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /** Fehlerkorrektur-Codewörter für einen Datenblock. */
  function rsEncode(data, eccCount) {
    const gen = rsGenerator(eccCount);
    const result = new Array(eccCount).fill(0);
    for (const byte of data) {
      const factor = byte ^ result[0];
      result.shift();
      result.push(0);
      if (factor !== 0) {
        for (let i = 0; i < gen.length - 1; i++) {
          result[i] ^= gfMul(gen[i + 1], factor);
        }
      }
    }
    return result;
  }

  /* ---------- Datenkodierung ---------- */

  function toUtf8Bytes(text) {
    return Array.from(new TextEncoder().encode(text));
  }

  function chooseVersion(byteLength) {
    for (let v = 1; v <= 10; v++) {
      if (byteLength <= CAPACITY[v - 1]) return v;
    }
    throw new Error('Der Inhalt ist zu lang für einen QR-Code.');
  }

  /** Baut den Bitstrom aus Modusindikator, Länge, Daten und Auffüllung. */
  function buildDataCodewords(bytes, version) {
    const [eccPerBlock, g1Blocks, g1Words, g2Blocks, g2Words] = ECC_TABLE[version - 1];
    const totalDataWords = g1Blocks * g1Words + g2Blocks * g2Words;

    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };

    push(0b0100, 4);                              // Byte-Modus
    push(bytes.length, version < 10 ? 8 : 16);    // Zeichenzähler
    bytes.forEach((b) => push(b, 8));

    // Terminator, dann auf volle Bytes auffüllen
    const capacityBits = totalDataWords * 8;
    for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      words.push(byte);
    }
    // Standard-Füllbytes, bis die Datenkapazität erreicht ist
    const PAD = [0xec, 0x11];
    let padIndex = 0;
    while (words.length < totalDataWords) {
      words.push(PAD[padIndex++ % 2]);
    }

    // In Blöcke aufteilen und Fehlerkorrektur je Block berechnen
    const dataBlocks = [];
    const eccBlocks = [];
    let offset = 0;
    for (let i = 0; i < g1Blocks; i++) {
      const block = words.slice(offset, offset + g1Words);
      offset += g1Words;
      dataBlocks.push(block);
      eccBlocks.push(rsEncode(block, eccPerBlock));
    }
    for (let i = 0; i < g2Blocks; i++) {
      const block = words.slice(offset, offset + g2Words);
      offset += g2Words;
      dataBlocks.push(block);
      eccBlocks.push(rsEncode(block, eccPerBlock));
    }

    // Verschachteln: erst die Daten-, dann die ECC-Wörter spaltenweise
    const result = [];
    const maxData = Math.max(g1Words, g2Words || 0);
    for (let i = 0; i < maxData; i++) {
      for (const block of dataBlocks) {
        if (i < block.length) result.push(block[i]);
      }
    }
    for (let i = 0; i < eccPerBlock; i++) {
      for (const block of eccBlocks) result.push(block[i]);
    }
    return result;
  }

  /* ---------- Matrixaufbau ---------- */

  function createMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(null));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    const setFunction = (x, y, value) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = value;
      reserved[y][x] = true;
    };

    // Suchmuster inklusive Trennlinien
    const placeFinder = (cx, cy) => {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const inRing = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
                         (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
          const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          setFunction(cx + dx, cy + dy, inRing || inCore ? 1 : 0);
        }
      }
    };
    placeFinder(0, 0);
    placeFinder(size - 7, 0);
    placeFinder(0, size - 7);

    // Taktmuster
    for (let i = 8; i < size - 8; i++) {
      const value = i % 2 === 0 ? 1 : 0;
      setFunction(i, 6, value);
      setFunction(6, i, value);
    }

    // Ausrichtungsmuster (nicht über den Suchmustern)
    const positions = ALIGNMENT[version - 1];
    for (const cy of positions) {
      for (const cx of positions) {
        const nearFinder =
          (cx <= 8 && cy <= 8) ||
          (cx >= size - 9 && cy <= 8) ||
          (cx <= 8 && cy >= size - 9);
        if (nearFinder) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ring = Math.max(Math.abs(dx), Math.abs(dy));
            setFunction(cx + dx, cy + dy, ring === 1 ? 0 : 1);
          }
        }
      }
    }

    // Dunkles Modul und reservierte Bereiche für die Formatinformation
    setFunction(8, size - 8, 1);
    for (let i = 0; i < 9; i++) {
      if (modules[8][i] === null) setFunction(i, 8, 0);
      if (modules[i][8] === null) setFunction(8, i, 0);
    }
    for (let i = 0; i < 8; i++) {
      if (modules[8][size - 1 - i] === null) setFunction(size - 1 - i, 8, 0);
      if (modules[size - 1 - i][8] === null) setFunction(8, size - 1 - i, 0);
    }

    // Versionsinformation (ab Version 7)
    if (version >= 7) {
      const info = VERSION_INFO[version];
      for (let i = 0; i < 18; i++) {
        const bit = (info >> i) & 1;
        const a = Math.floor(i / 3);
        const b = i % 3;
        setFunction(a, size - 11 + b, bit);
        setFunction(size - 11 + b, a, bit);
      }
    }

    return { modules, reserved, size };
  }

  /** Legt die Codewörter im Zickzack von rechts unten nach oben ab. */
  function placeData(matrix, codewords) {
    const { modules, reserved, size } = matrix;
    let bitIndex = 0;
    const nextBit = () => {
      const byte = codewords[bitIndex >> 3];
      const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
      bitIndex++;
      return bit;
    };

    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // Spalte des Taktmusters überspringen
      for (let step = 0; step < size; step++) {
        const y = upward ? size - 1 - step : step;
        for (let c = 0; c < 2; c++) {
          const x = right - c;
          if (reserved[y][x]) continue;
          modules[y][x] = nextBit();
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  /** Bewertet ein Muster nach den vier Strafregeln des Standards. */
  function penalty(modules, size) {
    let score = 0;

    // Regel 1: fünf oder mehr gleiche Module in Folge
    for (let i = 0; i < size; i++) {
      for (const horizontal of [true, false]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          const prev = horizontal ? modules[i][j - 1] : modules[j - 1][i];
          const cur = horizontal ? modules[i][j] : modules[j][i];
          if (cur === prev) {
            run++;
          } else {
            if (run >= 5) score += run - 2;
            run = 1;
          }
        }
        if (run >= 5) score += run - 2;
      }
    }

    // Regel 2: gleichfarbige 2×2-Blöcke
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const v = modules[y][x];
        if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) {
          score += 3;
        }
      }
    }

    // Regel 3: Muster, die dem Suchmuster ähneln
    const patternA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const patternB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matches = (get, start) => {
      const a = patternA.every((v, k) => get(start + k) === v);
      const b = patternB.every((v, k) => get(start + k) === v);
      return a || b;
    };
    for (let i = 0; i < size; i++) {
      for (let j = 0; j <= size - 11; j++) {
        if (matches((k) => modules[i][k], j)) score += 40;
        if (matches((k) => modules[k][i], j)) score += 40;
      }
    }

    // Regel 4: Abweichung vom ausgeglichenen Verhältnis hell/dunkel
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
    }
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  // Positionen [Zeile, Spalte] der Formatinformation, in der Reihenfolge
  // Bit 14 (höchstwertig) bis Bit 0. Die Zuordnung ist im Standard fest
  // vorgegeben und als Tabelle weniger fehleranfällig als Indexrechnerei.
  const FORMAT_POS = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];

  function applyFormatInfo(modules, size, mask) {
    const info = FORMAT_INFO[mask];
    for (let i = 0; i < 15; i++) {
      const bit = (info >> (14 - i)) & 1;

      const [row, col] = FORMAT_POS[i];
      modules[row][col] = bit;

      // Zweite Kopie: Bits 14–8 senkrecht unter dem linken unteren
      // Suchmuster, Bits 7–0 waagerecht links vom rechten oberen.
      if (i < 7) modules[size - 1 - i][8] = bit;
      else modules[8][size - 15 + i] = bit;
    }
  }

  /**
   * Erzeugt die Modulmatrix für einen Text.
   * @param {string} text
   * @returns {{size:number, modules:number[][]}} 1 = dunkel, 0 = hell
   */
  function encode(text) {
    const bytes = toUtf8Bytes(text);
    const version = chooseVersion(bytes.length);
    const codewords = buildDataCodewords(bytes, version);

    const matrix = createMatrix(version);
    placeData(matrix, codewords);

    // Beste Maske nach den Strafregeln wählen
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const candidate = matrix.modules.map((row, y) =>
        row.map((value, x) => (matrix.reserved[y][x] ? value : value ^ (MASKS[mask](x, y) ? 1 : 0)))
      );
      applyFormatInfo(candidate, matrix.size, mask);
      const score = penalty(candidate, matrix.size);
      if (!best || score < best.score) best = { score, modules: candidate };
    }

    return { size: matrix.size, modules: best.modules };
  }

  /**
   * Zeichnet den QR-Code als SVG.
   * @param {string} text
   * @param {number} pixelSize Kantenlänge in Bildpunkten
   * @returns {SVGElement}
   */
  function toSvg(text, pixelSize = 180) {
    const { size, modules } = encode(text);
    const quiet = 4; // vom Standard geforderter heller Rand
    const total = size + quiet * 2;

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('width', pixelSize);
    svg.setAttribute('height', pixelSize);
    svg.setAttribute('shape-rendering', 'crispEdges');

    const background = document.createElementNS(svgNs, 'rect');
    background.setAttribute('width', total);
    background.setAttribute('height', total);
    background.setAttribute('fill', '#ffffff');
    svg.appendChild(background);

    // Alle dunklen Module als ein Pfad – deutlich weniger DOM-Knoten.
    let path = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      }
    }
    const shape = document.createElementNS(svgNs, 'path');
    shape.setAttribute('d', path);
    shape.setAttribute('fill', '#000000');
    svg.appendChild(shape);

    return svg;
  }

  return { encode, toSvg };
})();
