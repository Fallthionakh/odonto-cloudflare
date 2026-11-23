// Décompresseur DEFLATE "raw" (RFC 1951), en JS pur, sans aucune dépendance.
// Nécessaire car le runtime Cloudflare Workers n'a pas accès à node:zlib —
// contrairement à la version Node.js (odonto-app), qui utilise
// zlib.inflateRawSync. Un classeur .xlsx réel (Excel/LibreOffice/Google
// Sheets) compresse presque toujours ses entrées en DEFLATE (méthode ZIP 8),
// donc ce module est nécessaire pour lire un fichier importé par
// l'utilisateur (notre propre générateur, lui, écrit en "stored"/méthode 0,
// qui n'a pas besoin de ce décodeur).
'use strict';

// --- Lecteur de bits (LSB-first pour les valeurs multi-bits, comme l'exige
//     DEFLATE ; les codes de Huffman, eux, sont lus bit à bit en les
//     accumulant MSB-first — voir decodeSymbol ci-dessous). -------------
class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  readBit() {
    if (this.bitCount === 0) {
      if (this.pos >= this.bytes.length) throw new Error('DEFLATE : fin de flux inattendue');
      this.bitBuf = this.bytes[this.pos++];
      this.bitCount = 8;
    }
    const bit = this.bitBuf & 1;
    this.bitBuf >>= 1;
    this.bitCount -= 1;
    return bit;
  }

  readBits(n) {
    let value = 0;
    for (let i = 0; i < n; i++) value |= this.readBit() << i;
    return value;
  }

  alignToByte() {
    this.bitBuf = 0;
    this.bitCount = 0;
  }
}

// --- Arbre de Huffman canonique -----------------------------------------
// Construit à partir d'un tableau de longueurs de code (une par symbole,
// 0 = symbole absent), selon l'algorithme canonique décrit en RFC 1951 §3.2.2.
function buildHuffman(lengths) {
  const maxLen = Math.max(0, ...lengths);
  const blCount = new Array(maxLen + 1).fill(0);
  for (const len of lengths) if (len > 0) blCount[len] += 1;

  const nextCode = new Array(maxLen + 1).fill(0);
  let code = 0;
  for (let len = 1; len <= maxLen; len++) {
    code = (code + blCount[len - 1]) << 1;
    nextCode[len] = code;
  }

  // codesByLen[len] : Map(code -> symbole), pour un décodage bit-à-bit.
  const codesByLen = new Array(maxLen + 1);
  for (let len = 1; len <= maxLen; len++) codesByLen[len] = new Map();

  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const len = lengths[symbol];
    if (len === 0) continue;
    const c = nextCode[len]++;
    codesByLen[len].set(c, symbol);
  }

  return { codesByLen, maxLen };
}

function decodeSymbol(reader, huffman) {
  let code = 0;
  for (let len = 1; len <= huffman.maxLen; len++) {
    code = (code << 1) | reader.readBit();
    const map = huffman.codesByLen[len];
    if (map && map.has(code)) return map.get(code);
  }
  throw new Error('DEFLATE : code de Huffman invalide');
}

// --- Tables fixes (RFC 1951 §3.2.6) -------------------------------------
const FIXED_LIT_LENGTHS = (() => {
  const lengths = new Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return lengths;
})();
const FIXED_DIST_LENGTHS = new Array(30).fill(5);

// --- Tables longueur/distance (RFC 1951 §3.2.5) -------------------------
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// --- Sortie extensible ---------------------------------------------------
class ByteSink {
  constructor(initialSize) {
    this.buf = new Uint8Array(Math.max(initialSize, 1024));
    this.len = 0;
  }

  ensure(extra) {
    if (this.len + extra <= this.buf.length) return;
    let newSize = this.buf.length * 2;
    while (newSize < this.len + extra) newSize *= 2;
    const next = new Uint8Array(newSize);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  push(byte) {
    this.ensure(1);
    this.buf[this.len++] = byte;
  }

  pushRun(sourceOffsetFromEnd, length) {
    // Copie "length" octets déjà écrits, en commençant "sourceOffsetFromEnd"
    // octets avant la position courante (chevauchement autorisé et même
    // courant en DEFLATE, ex. distance 1 pour répéter le dernier octet).
    this.ensure(length);
    let src = this.len - sourceOffsetFromEnd;
    for (let i = 0; i < length; i++) {
      this.buf[this.len++] = this.buf[src++];
    }
  }

  toUint8Array() {
    return this.buf.subarray(0, this.len);
  }
}

function readCodeLengths(reader, codeLengthHuffman, totalCount) {
  const lengths = new Array(totalCount).fill(0);
  let i = 0;
  let prev = 0;
  while (i < totalCount) {
    const sym = decodeSymbol(reader, codeLengthHuffman);
    if (sym <= 15) {
      lengths[i++] = sym;
      prev = sym;
    } else if (sym === 16) {
      const repeat = 3 + reader.readBits(2);
      for (let r = 0; r < repeat && i < totalCount; r++) lengths[i++] = prev;
    } else if (sym === 17) {
      const repeat = 3 + reader.readBits(3);
      for (let r = 0; r < repeat && i < totalCount; r++) lengths[i++] = 0;
      prev = 0;
    } else if (sym === 18) {
      const repeat = 11 + reader.readBits(7);
      for (let r = 0; r < repeat && i < totalCount; r++) lengths[i++] = 0;
      prev = 0;
    } else {
      throw new Error('DEFLATE : symbole de longueur de code invalide');
    }
  }
  return lengths;
}

function inflateBlock(reader, sink, litHuffman, distHuffman) {
  for (;;) {
    const sym = decodeSymbol(reader, litHuffman);
    if (sym < 256) {
      sink.push(sym);
    } else if (sym === 256) {
      return; // fin de bloc
    } else {
      const idx = sym - 257;
      if (idx >= LENGTH_BASE.length) throw new Error('DEFLATE : code de longueur invalide');
      const length = LENGTH_BASE[idx] + reader.readBits(LENGTH_EXTRA[idx]);
      const distSym = decodeSymbol(reader, distHuffman);
      if (distSym >= DIST_BASE.length) throw new Error('DEFLATE : code de distance invalide');
      const distance = DIST_BASE[distSym] + reader.readBits(DIST_EXTRA[distSym]);
      sink.pushRun(distance, length);
    }
  }
}

/**
 * Décompresse un flux DEFLATE "raw" (sans en-tête zlib/gzip), tel que
 * produit par la méthode de compression ZIP n°8. Renvoie un Uint8Array.
 */
export function inflateRaw(input, expectedSize) {
  const reader = new BitReader(input);
  const sink = new ByteSink(expectedSize || input.length * 3);

  let bfinal = 0;
  do {
    bfinal = reader.readBit();
    const btype = reader.readBits(2);

    if (btype === 0) {
      // Bloc non compressé : alignement sur l'octet, puis copie directe.
      reader.alignToByte();
      const len = input[reader.pos] | (input[reader.pos + 1] << 8);
      reader.pos += 4; // LEN (2 octets) + NLEN (2 octets, ignoré)
      sink.ensure(len);
      for (let i = 0; i < len; i++) sink.push(input[reader.pos++]);
    } else if (btype === 1) {
      const litHuffman = buildHuffman(FIXED_LIT_LENGTHS);
      const distHuffman = buildHuffman(FIXED_DIST_LENGTHS);
      inflateBlock(reader, sink, litHuffman, distHuffman);
    } else if (btype === 2) {
      const hlit = reader.readBits(5) + 257;
      const hdist = reader.readBits(5) + 1;
      const hclen = reader.readBits(4) + 4;

      const codeLengthLengths = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) codeLengthLengths[CODE_LENGTH_ORDER[i]] = reader.readBits(3);
      const codeLengthHuffman = buildHuffman(codeLengthLengths);

      const allLengths = readCodeLengths(reader, codeLengthHuffman, hlit + hdist);
      const litLengths = allLengths.slice(0, hlit);
      const distLengths = allLengths.slice(hlit);

      const litHuffman = buildHuffman(litLengths);
      const distHuffman = buildHuffman(distLengths);
      inflateBlock(reader, sink, litHuffman, distHuffman);
    } else {
      throw new Error('DEFLATE : type de bloc réservé (invalide)');
    }
  } while (!bfinal);

  return sink.toUint8Array();
}
