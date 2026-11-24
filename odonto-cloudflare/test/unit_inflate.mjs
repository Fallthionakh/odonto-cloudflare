// Test du décompresseur DEFLATE pur JS (src/utils/xlsx/inflate.js), seul
// morceau de code propre au runtime Cloudflare Workers pour la lecture de
// fichiers .xlsx (la version Node.js utilise node:zlib, indisponible ici).
// Compare la sortie à zlib.inflateRawSync (référence) sur des cas
// synthétiques et sur les vraies entrées compressées du fichier
// d'exemple test/registre_test.xlsx. Lancer avec : node test/unit_inflate.mjs
'use strict';

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRaw } from '../src/utils/xlsx/inflate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(label, cond) {
  if (cond) console.log('OK  ', label);
  else { console.error('FAIL', label); failures += 1; }
}

function roundtrip(label, original) {
  const compressed = zlib.deflateRawSync(Buffer.from(original), { level: 9 });
  const decompressed = inflateRaw(new Uint8Array(compressed));
  check(`${label} (len ${original.length})`, Buffer.compare(Buffer.from(decompressed), Buffer.from(original)) === 0);
}

roundtrip('vide', Buffer.alloc(0));
roundtrip('texte court', Buffer.from('Bonjour le monde, ceci est un test.', 'utf8'));
roundtrip('texte répétitif (références arrière)', Buffer.from('abcabcabcabcabcabcabcabcabcabc', 'utf8'));
roundtrip('caractère répété (distance = 1)', Buffer.from('a'.repeat(5000), 'utf8'));
roundtrip('données peu compressibles', Buffer.from(Array.from({ length: 20000 }, () => Math.floor(Math.random() * 256))));
roundtrip('texte français avec accents (bloc dynamique)', Buffer.from('Le service d’odonto-stomatologie enregistre les patients.'.repeat(300), 'utf8'));

function listZipEntries(buf) {
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocdOffset = i; break; }
  }
  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  let offset = buf.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let i = 0; i < numEntries; i++) {
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    entries.push({ name, method, uncompressedSize, data: buf.subarray(dataStart, dataStart + compressedSize) });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

const xbuf = fs.readFileSync(path.join(__dirname, 'registre_test.xlsx'));
for (const e of listZipEntries(xbuf)) {
  if (e.method !== 8) continue;
  const mine = inflateRaw(new Uint8Array(e.data), e.uncompressedSize);
  const ref = zlib.inflateRawSync(e.data);
  check(`entrée réelle "${e.name}"`, Buffer.compare(Buffer.from(mine), ref) === 0 && mine.length === e.uncompressedSize);
}

console.log('\n' + (failures === 0 ? 'TOUS LES TESTS INFLATE SONT PASSÉS' : `${failures} ÉCHEC(S)`));
process.exit(failures === 0 ? 0 : 1);
