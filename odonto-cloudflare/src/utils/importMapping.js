// Logique de correspondance "colonne Excel -> champ de l'application" pour
// la fonctionnalité d'import — identique à odonto-app/src/utils/importMapping.js,
// seulement réécrite en modules ES (imports de src/data/*.js au lieu de
// require() de fichiers .json). Ne décide jamais seule : elle ne fait que
// SUGGÉRER une correspondance, que l'utilisateur doit confirmer côté
// interface avant tout import réel (voir routes/import.js). Aucune valeur
// n'est jamais inventée : une valeur non reconnue reste vide et est signalée.
'use strict';

import importFields from '../data/importFields.js';
import indicateurs from '../data/indicateurs.js';

export function normalizeText(text) {
  return String(text == null ? '' : text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveFieldDef(def) {
  if (def.type && def.type.startsWith('enum_dynamic:')) {
    const source = def.type.split(':')[1];
    const list = indicateurs[source] || [];
    const values = {};
    for (const item of list) {
      values[item.id] = [normalizeText(item.libelle), normalizeText(item.id)];
    }
    return { ...def, type: 'enum', values };
  }
  return def;
}

export function fieldCatalog() {
  const patient = {};
  for (const [key, def] of Object.entries(importFields.patient)) patient[key] = resolveFieldDef(def);
  const consultation = {};
  for (const [key, def] of Object.entries(importFields.consultation)) consultation[key] = resolveFieldDef(def);
  return { patient, consultation };
}

function buildSynonymIndex(catalog) {
  const index = new Map();
  const add = (entity, field, def) => {
    const texts = new Set([normalizeText(def.label), ...(def.synonyms || []).map(normalizeText)]);
    for (const t of texts) {
      if (!t) continue;
      if (!index.has(t)) index.set(t, []);
      index.get(t).push({ entity, field });
    }
  };
  for (const [field, def] of Object.entries(catalog.patient)) add('patient', field, def);
  for (const [field, def] of Object.entries(catalog.consultation)) add('consultation', field, def);
  return index;
}

export function suggestMapping(headers) {
  const catalog = fieldCatalog();
  const index = buildSynonymIndex(catalog);
  return headers.map((header, i) => {
    const norm = normalizeText(header);
    const matches = index.get(norm);
    let suggestion = null;
    if (matches && matches.length === 1) {
      suggestion = `${matches[0].entity}.${matches[0].field}`;
    }
    return { index: i, header, suggestion };
  });
}

export function parseDateValue(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null, warning: null };
  const asNum = typeof raw === 'number' ? raw : /^-?\d+(\.\d+)?$/.test(String(raw).trim()) ? Number(raw) : null;
  if (asNum !== null && asNum > 0 && asNum < 100000) {
    const ms = Math.round((asNum - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return { value: d.toISOString().slice(0, 10), warning: null };
  }
  const text = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const d = new Date(`${text}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return { value: text, warning: null };
  }
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(text);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return { value: d.toISOString().slice(0, 10), warning: null };
  }
  return { value: null, warning: `date non reconnue (« ${text} »)` };
}

export function parseBoolValue(raw) {
  if (raw === null || raw === undefined || raw === '') return false;
  const norm = normalizeText(raw);
  return ['oui', 'yes', 'vrai', 'true', '1', 'x'].includes(norm);
}

export function parseNumberValue(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null, warning: null };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, warning: null } : { value: null, warning: `montant non reconnu (« ${raw} »)` };
  let text = String(raw).trim().replace(/[^\d.,-]/g, '');
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const n = Number(text);
  if (!Number.isFinite(n)) return { value: null, warning: `montant non reconnu (« ${raw} »)` };
  return { value: n, warning: null };
}

export function splitListValue(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  return String(raw)
    .split(/[;,|\/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeEnumValue(raw, fieldDef) {
  if (raw === null || raw === undefined || raw === '') return { value: null, warning: null };
  const norm = normalizeText(raw);
  for (const [canonical, synonyms] of Object.entries(fieldDef.values || {})) {
    if (normalizeText(canonical) === norm) return { value: canonical, warning: null };
    if ((synonyms || []).some((s) => normalizeText(s) === norm)) return { value: canonical, warning: null };
  }
  return { value: null, warning: `valeur « ${raw} » non reconnue pour « ${fieldDef.label} »` };
}

export function coerceFieldValue(raw, fieldDef) {
  const type = fieldDef.type;
  if (type === 'enum') return normalizeEnumValue(raw, fieldDef);
  if (type === 'date') return parseDateValue(raw);
  if (type === 'bool') return { value: parseBoolValue(raw), warning: null };
  if (type === 'number') return parseNumberValue(raw);
  if (type === 'list') return { value: splitListValue(raw), warning: null };
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  return { value: text || null, warning: null };
}
