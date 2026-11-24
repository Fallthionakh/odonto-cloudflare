// Écrivain ZIP minimal (juste ce qu'il faut pour produire un .xlsx), en JS
// pur (Uint8Array), sans aucune dépendance (ni node:zlib, ni archiver/jszip)
// — ce qui le rend compatible aussi bien avec Node.js qu'avec le runtime
// Cloudflare Workers. Les entrées sont stockées sans compression (méthode
// ZIP "stored") : un fichier .xlsx ainsi produit reste parfaitement valide
// et s'ouvre normalement dans Excel/LibreOffice/Google Sheets.
'use strict';

const DOS_TIME = 0; // horodatage neutre, non significatif pour un tableur
const DOS_DATE = (1 << 5) | 1; // 1er janvier, valeur fixe arbitraire

// Table CRC-32 (polynôme standard 0xEDB88320), calculée une seule fois.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  return new TextEncoder().encode(data);
}

function u16(view, offset, value) {
  view.setUint16(offset, value, true);
}
function u32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * @param {Array<{name: string, data: string|Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const data = toBytes(file.data);
    const nameBuf = new TextEncoder().encode(file.name);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30);
    const lv = new DataView(localHeader.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20); // version needed
    u16(lv, 6, 0); // flags
    u16(lv, 8, 0); // method: stored (sans compression)
    u16(lv, 10, DOS_TIME);
    u16(lv, 12, DOS_DATE);
    u32(lv, 14, crc);
    u32(lv, 18, data.length); // taille compressée == taille réelle (stored)
    u32(lv, 22, data.length);
    u16(lv, 26, nameBuf.length);
    u16(lv, 28, 0); // extra length

    localChunks.push(localHeader, nameBuf, data);

    const centralHeader = new Uint8Array(46);
    const cv = new DataView(centralHeader.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20); // version made by
    u16(cv, 6, 20); // version needed
    u16(cv, 8, 0); // flags
    u16(cv, 10, 0); // method
    u16(cv, 12, DOS_TIME);
    u16(cv, 14, DOS_DATE);
    u32(cv, 16, crc);
    u32(cv, 20, data.length);
    u32(cv, 24, data.length);
    u16(cv, 28, nameBuf.length);
    u16(cv, 30, 0); // extra length
    u16(cv, 32, 0); // comment length
    u16(cv, 34, 0); // disk number start
    u16(cv, 36, 0); // internal attrs
    u32(cv, 38, 0); // external attrs
    u32(cv, 42, offset); // offset of local header

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralDirStart = offset;
  const centralDirBuf = concatBytes(centralChunks);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0); // disk number
  u16(ev, 6, 0); // disk with central dir
  u16(ev, 8, files.length); // entries this disk
  u16(ev, 10, files.length); // entries total
  u32(ev, 12, centralDirBuf.length); // size of central dir
  u32(ev, 16, centralDirStart); // offset of central dir
  u16(ev, 20, 0); // comment length

  return concatBytes([...localChunks, centralDirBuf, eocd]);
}
