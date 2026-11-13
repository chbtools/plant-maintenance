/* Byte-mode QR, error correction L, versions 1 through 5.
   Enough for an asset link. The matrix includes finder patterns so a phone can scan it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CAP = [0, 17, 32, 53, 78, 106];
  const ECCW = [0, 7, 10, 15, 20, 26];
  const DATAW = [0, 19, 34, 55, 80, 108];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30]];

  function gfMul(a, b) {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 255;
      if (hi) a ^= 0x1d;
      b >>= 1;
    }
    return p;
  }
  function rsGenerator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= gfMul(g[j], gfPow(2, i));
      }
      g = next;
    }
    return g;
  }
  const EXP = [];
  const LOG = new Array(256);
  (function init() {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = gfMul(x, 2); }
    EXP[255] = EXP[0];
  })();
  function gfPow(a, e) {
    if (a === 0) return 0;
    return EXP[(LOG[a] * e) % 255];
  }
  function rsEncode(data, eccLen) {
    const gen = rsGenerator(eccLen);
    const out = data.concat(new Array(eccLen).fill(0));
    for (let i = 0; i < data.length; i++) {
      const k = out[i];
      if (!k) continue;
      for (let j = 0; j < gen.length; j++) out[i + j] ^= gfMul(gen[j], k);
    }
    return out.slice(data.length);
  }

  function bits() {
    const a = [];
    return {
      add(v, n) { for (let i = n - 1; i >= 0; i--) a.push((v >>> i) & 1); },
      arr: a
    };
  }
  function bytesOf(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 255) throw new Error("QR text must be plain ASCII");
      out.push(c);
    }
    return out;
  }
  function pickVersion(len) {
    for (let v = 1; v <= 5; v++) if (len <= CAP[v]) return v;
    throw new Error("That link is too long for a label QR");
  }
  function dataCodewords(text) {
    const raw = bytesOf(text);
    const v = pickVersion(raw.length);
    const b = bits();
    b.add(0b0100, 4);
    b.add(raw.length, 8);
    raw.forEach(n => b.add(n, 8));
    const cap = DATAW[v] * 8;
    const term = Math.min(4, cap - b.arr.length);
    b.add(0, term);
    while (b.arr.length % 8) b.arr.push(0);
    const bytes = [];
    for (let i = 0; i < b.arr.length; i += 8) {
      let n = 0;
      for (let k = 0; k < 8; k++) n = (n << 1) | b.arr[i + k];
      bytes.push(n);
    }
    const pads = [0xec, 0x11];
    let p = 0;
    while (bytes.length < DATAW[v]) bytes.push(pads[p++ % 2]);
    return { version: v, data: bytes, ecc: rsEncode(bytes, ECCW[v]) };
  }

  function sizeOf(v) { return 17 + 4 * v; }
  function inFinder(x, y, n) {
    const boxes = [[0, 0], [n - 7, 0], [0, n - 7]];
    return boxes.some(([bx, by]) => x >= bx && x < bx + 7 && y >= by && y < by + 7);
  }
  function finderOn(x, y) {
    const lx = x % 7, ly = y % 7;
    // caller passes local coords
    if (lx === 0 || ly === 0 || lx === 6 || ly === 6) return 1;
    if (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4) return 1;
    return 0;
  }
  function moduleFinder(x, y, n) {
    const origins = [[0, 0], [n - 7, 0], [0, n - 7]];
    for (const [ox, oy] of origins) {
      if (x >= ox && x < ox + 7 && y >= oy && y < oy + 7) return finderOn(x - ox, y - oy);
    }
    return null;
  }

  function build(text) {
    const pack = dataCodewords(text);
    const v = pack.version;
    const n = sizeOf(v);
    const dark = Array.from({ length: n }, () => Array(n).fill(0));
    const func = Array.from({ length: n }, () => Array(n).fill(false));
    function setF(x, y, bit) { if (x < 0 || y < 0 || x >= n || y >= n) return; dark[y][x] = bit ? 1 : 0; func[y][x] = true; }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const bit = moduleFinder(x, y, n);
      if (bit != null) setF(x, y, bit);
    }
    for (let i = 0; i < 8; i++) { setF(7, i, 0); setF(i, 7, 0); setF(n - 8, i, 0); setF(i, n - 8, 0); setF(7, n - 1 - i, 0); setF(n - 1 - i, 7, 0); }
    for (let i = 8; i < n - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const aligns = ALIGN[v];
    for (const ax of aligns) for (const ay of aligns) {
      if ((ax < 9 && ay < 9) || (ax > n - 10 && ay < 9) || (ax < 9 && ay > n - 10)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const on = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
        setF(ax + dx, ay + dy, on);
      }
    }
    setF(8, n - 8, 1);
    const bits = [];
    pack.data.concat(pack.ecc).forEach(by => { for (let i = 7; i >= 0; i--) bits.push((by >>> i) & 1); });
    let bi = 0;
    let upward = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < n; i++) {
        const y = upward ? n - 1 - i : i;
        for (const x of [col, col - 1]) {
          if (func[y][x]) continue;
          dark[y][x] = bi < bits.length ? bits[bi++] : 0;
        }
      }
      upward = !upward;
    }
    return { dark, func, version: v, n };
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }
  function formatBits(mask) {
    const data = (0b01 << 3) | mask;
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0b10100110111 << (i - 10);
    return ((data << 10) | rem) ^ 0b101010000010010;
  }
  function applyFormat(modules, func, mask) {
    const n = modules.length;
    const bits = formatBits(mask);
    const coords = [];
    for (let i = 0; i <= 5; i++) coords.push([8, i]);
    coords.push([8, 7], [8, 8], [7, 8]);
    for (let i = 5; i >= 0; i--) coords.push([i, 8]);
    const coords2 = [];
    for (let i = 0; i < 7; i++) coords2.push([n - 1 - i, 8]);
    for (let i = 0; i < 8; i++) coords2.push([8, n - 8 + i]);
    coords.forEach(([x, y], i) => { modules[y][x] = (bits >>> (14 - i)) & 1; });
    coords2.forEach(([x, y], i) => { modules[y][x] = (bits >>> (14 - i)) & 1; });
    modules[n - 8][8] = 1;
  }
  function penalty(m) {
    const n = m.length;
    let score = 0;
    for (let y = 0; y < n; y++) {
      let run = 1;
      for (let x = 1; x < n; x++) {
        if (m[y][x] === m[y][x - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    let dark = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) dark += m[y][x];
    const pct = Math.abs(Math.floor(dark * 100 / (n * n)) - 50);
    score += Math.floor(pct / 5) * 10;
    return score;
  }
  function matrix(text) {
    const base = build(String(text));
    let best = null;
    let bestScore = Infinity;
    let bestMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      const m = base.dark.map(row => row.slice());
      for (let y = 0; y < base.n; y++) for (let x = 0; x < base.n; x++) {
        if (!base.func[y][x] && maskBit(mask, x, y)) m[y][x] ^= 1;
      }
      applyFormat(m, base.func, mask);
      const score = penalty(m);
      if (score < bestScore) { bestScore = score; best = m; bestMask = mask; }
    }
    return best;
  }
  function svg(text, quiet) {
    const m = matrix(text);
    const q = quiet == null ? 2 : quiet;
    const n = m.length + q * 2;
    let body = "";
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) body += `<rect x="${x + q}" y="${y + q}" width="1" height="1"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><g fill="#111">${body}</g></svg>`;
  }
  return { matrix, svg, sizeOf, pickVersion };
});
