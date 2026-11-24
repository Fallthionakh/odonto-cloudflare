// Lecteur .xlsx pour Cloudflare Workers — même logique et même contrat que
// la version Node.js (odonto-app/src/utils/xlsx/xlsxReader.js), mais sans
// node:zlib (indisponible dans ce runtime) : la décompression DEFLATE
// passe par ./inflate.js (pur JS, voir ce fichier pour le détail et ses
// propres tests). Le reste (parsing ZIP, OOXML, dates) est identique,
// seulement réécrit avec des API web (Uint8Array/DataView/TextDecoder) à
// la place de Buffer.
'use strict';

import { inflateRaw } from './inflate.js';

const textDecoder = new TextDecoder('utf-8');

// --- Lecture du conteneur ZIP (depuis la fin : End Of Central Directory) --

function findEOCD(bytes, view) {
  const sig = 0x06054b50;
  const minLen = 22;
  for (let i = bytes.length - minLen; i >= Math.max(0, bytes.length - minLen - 65536); i--) {
    if (view.getUint32(i, true) === sig) return i;
  }
  throw new Error("Fichier .xlsx invalide : fin d'archive ZIP introuvable");
}

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEOCD(bytes, view);
  const numEntries = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map(); // name -> Uint8Array (décompressé)

  for (let i = 0; i < numEntries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Fichier .xlsx invalide : en-tête de répertoire central corrompu');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Fichier .xlsx invalide : en-tête local corrompu pour ${name}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = inflateRaw(compressed, uncompressedSize);
    } else {
      throw new Error(`Méthode de compression ZIP non supportée (${method}) pour ${name}`);
    }
    entries.set(name, data);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

// --- Décodage XML minimal (suffisant pour le sous-ensemble OOXML produit
// par Excel/LibreOffice/Google Sheets) -------------------------------------

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const block = m[1];
    let text = '';
    let tm;
    tRe.lastIndex = 0;
    while ((tm = tRe.exec(block))) text += unescapeXml(tm[1]);
    strings.push(text);
  }
  return strings;
}

function colLetterToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1; // 0-based
}

function parseCellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
  if (!m) return null;
  return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) };
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowAttrs = rm[1];
    const rowContent = rm[2];
    const rNumMatch = /\br="(\d+)"/.exec(rowAttrs);
    const rowNum = rNumMatch ? parseInt(rNumMatch[1], 10) : rows.length + 1;

    const rowArr = [];
    cellRe.lastIndex = 0;
    let cm;
    while ((cm = cellRe.exec(rowContent))) {
      const attrs = cm[1];
      const content = cm[2];
      const refMatch = /\br="([A-Z]+\d+)"/.exec(attrs);
      const ref = refMatch ? parseCellRef(refMatch[1]) : null;
      const colIdx = ref ? ref.col : rowArr.length;
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : null;

      let value = null;
      if (content) {
        if (type === 'inlineStr') {
          const isMatch = /<is>([\s\S]*?)<\/is>/.exec(content);
          if (isMatch) {
            let text = '';
            const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
            let tm;
            while ((tm = tRe.exec(isMatch[1]))) text += unescapeXml(tm[1]);
            value = text;
          }
        } else {
          const vMatch = /<v>([\s\S]*?)<\/v>/.exec(content);
          if (vMatch) {
            const raw = unescapeXml(vMatch[1]);
            if (type === 's') {
              const idx = parseInt(raw, 10);
              value = sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
            } else if (type === 'b') {
              value = raw === '1';
            } else if (type === 'str') {
              value = raw;
            } else {
              value = raw; // nombre (texte brut, conversion faite par l'appelant si besoin)
            }
          }
        }
      }

      while (rowArr.length < colIdx) rowArr.push(null);
      rowArr[colIdx] = value;
    }

    rows[rowNum - 1] = rowArr; // préserve les lignes vides omises par Excel
  }

  const maxRow = rows.length;
  for (let i = 0; i < maxRow; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function parseFirstSheetPath(entries) {
  const workbookXml = entries.get('xl/workbook.xml');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbookXml) return 'xl/worksheets/sheet1.xml';

  const workbookStr = textDecoder.decode(workbookXml);
  const sheetMatch = /<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"[^>]*\/>/.exec(workbookStr);
  if (!sheetMatch || !relsXml) return 'xl/worksheets/sheet1.xml';

  const rId = sheetMatch[2];
  const relsStr = textDecoder.decode(relsXml);
  const relMatch = new RegExp(`<Relationship\\b[^>]*\\bId="${rId}"[^>]*\\bTarget="([^"]*)"`).exec(relsStr);
  if (!relMatch) return 'xl/worksheets/sheet1.xml';
  let target = relMatch[1];
  if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.?\//, '')}`;
  return target;
}

// Convertit un numéro de série de date Excel (système 1900) en date ISO
// (AAAA-MM-JJ). Reproduit volontairement le bug du 29 février 1900 d'Excel,
// pour rester cohérent avec ce que l'utilisateur voit dans son tableur.
export function excelSerialToISODate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Lit un classeur .xlsx (Uint8Array ou ArrayBuffer) et renvoie
 * { headers, rows } où `headers` est la 1ère ligne et `rows` les lignes
 * suivantes, chacune un tableau aligné sur `headers` (valeurs brutes,
 * aucune interprétation métier ici — elle est faite par l'appelant via le
 * dictionnaire de rubriques, voir utils/importMapping.js).
 */
export function readXlsx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = readZipEntries(bytes);
  const sharedStringsBytes = entries.get('xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(sharedStringsBytes ? textDecoder.decode(sharedStringsBytes) : '');

  const sheetPath = parseFirstSheetPath(entries);
  const sheetBytes = entries.get(sheetPath) || entries.get('xl/worksheets/sheet1.xml');
  if (!sheetBytes) throw new Error('Fichier .xlsx invalide : aucune feuille trouvée');

  const allRows = parseSheetRows(textDecoder.decode(sheetBytes), sharedStrings);
  if (allRows.length === 0) return { headers: [], rows: [] };

  const headerRow = allRows[0];
  const width = headerRow.length;
  const headers = headerRow.map((h) => (h === null || h === undefined ? '' : String(h).trim()));

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    const isEmpty = r.every((v) => v === null || v === undefined || v === '');
    if (isEmpty) continue;
    const padded = [];
    for (let c = 0; c < width; c++) padded.push(r[c] !== undefined ? r[c] : null);
    rows.push(padded);
  }

  return { headers, rows };
}
