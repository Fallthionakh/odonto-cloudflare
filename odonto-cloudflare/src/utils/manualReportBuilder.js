// Mode de saisie directe (manuelle) du rapport d'activité, en complément du
// mode automatique (reportBuilder.js) basé sur les consultations
// enregistrées patient par patient. L'utilisateur saisit directement les
// chiffres mois par mois (comme sur un tableau papier/Excel) ; les rapports
// trimestriels, semestriels et annuels ne sont JAMAIS ressaisis : ils sont
// systématiquement recalculés en additionnant les mois déjà saisis.
// Version Cloudflare Worker : les saisies vivent dans la table Supabase
// odonto_manual_reports (une ligne par mois, clé 'periode' = 'AAAA-MM', une
// colonne JSON 'data') au lieu de SQLite. Produit exactement la même forme
// que buildReport() (reportBuilder.js) pour réutiliser l'export Excel
// (xlsx/reportExcel.js) et le rendu à l'écran côté frontend.
'use strict';

import { HttpError } from '../router.js';
import { sbSelect, sbInsert, sbUpdate } from '../supabase.js';
import { AGE_GROUPS } from './ageGroups.js';
import pathologies from '../data/pathologies.js';
import treatments from '../data/treatments.js';
import indicateurs from '../data/indicateurs.js';
import { periodMonths, periodRangeFromMonths } from './periodUtils.js';

const AUTRES_DIAG_ID = 'AUTRES_DIAG';

// --- Définition des lignes (même référentiel que le rapport automatique) --
export function rowDefs() {
  const morbidite = pathologies.map((p) => ({ id: p.id, libelle: p.libelle || p.categorie, categorie: p.categorie }));
  morbidite.push({
    id: AUTRES_DIAG_ID,
    libelle: 'Autres diagnostics (ajoutés)',
    categorie: 'Autres diagnostics (ajoutés)',
  });
  const indicateursMorbidite = indicateurs.morbidite.map((i) => ({ id: i.id, libelle: i.libelle }));
  const therapeutique = treatments.map((t) => ({ id: t.id, libelle: t.libelle }));
  const mortalite = indicateurs.mortalite.map((m) => ({ id: m.id, libelle: m.libelle }));
  return { morbidite, indicateursMorbidite, therapeutique, mortalite };
}

function emptyRow() {
  const row = { parAge: {}, femmeEnceinte: 0 };
  for (const ag of AGE_GROUPS) row.parAge[ag] = { M: 0, F: 0 };
  return row;
}

function rowTotals(row) {
  let M = 0;
  let F = 0;
  for (const ag of AGE_GROUPS) {
    M += row.parAge[ag].M;
    F += row.parAge[ag].F;
  }
  return { M, F, global: M + F };
}

function finalizeRow(id, libelle, extra, row) {
  return { id, libelle, ...extra, parAge: row.parAge, femmeEnceinte: row.femmeEnceinte, totaux: rowTotals(row) };
}

function toNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

// --- Lecture / écriture des saisies mensuelles -----------------------------
async function loadMonthRaw(env, periode) {
  const rows = (await sbSelect(env, 'odonto_manual_reports', `select=data&periode=eq.${encodeURIComponent(periode)}`)) || [];
  if (!rows.length) return null;
  try {
    return typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
  } catch {
    return null;
  }
}

function sanitizeSection(defs, sectionPayload) {
  const result = {};
  const validIds = new Set(defs.map((d) => d.id));
  if (!sectionPayload || typeof sectionPayload !== 'object') return result;
  for (const [id, val] of Object.entries(sectionPayload)) {
    // Une ligne inconnue (absente du référentiel courant) n'est jamais
    // inventée ni ajoutée : elle est simplement ignorée.
    if (!validIds.has(id)) continue;
    const parAge = {};
    for (const ag of AGE_GROUPS) {
      const v = val && val.parAge && val.parAge[ag];
      parAge[ag] = { M: toNonNegInt(v && v.M), F: toNonNegInt(v && v.F) };
    }
    result[id] = { parAge, femmeEnceinte: toNonNegInt(val && val.femmeEnceinte) };
  }
  return result;
}

export async function saveManualReportMonth(env, periode, payload, userId) {
  if (!/^\d{4}-\d{2}$/.test(periode || '')) throw new HttpError(400, 'Période invalide (AAAA-MM attendu)');
  const defs = rowDefs();
  const data = {
    morbidite: sanitizeSection(defs.morbidite, payload && payload.morbidite),
    indicateursMorbidite: sanitizeSection(defs.indicateursMorbidite, payload && payload.indicateursMorbidite),
    therapeutique: sanitizeSection(defs.therapeutique, payload && payload.therapeutique),
    mortalite: sanitizeSection(defs.mortalite, payload && payload.mortalite),
  };

  const existing = (await sbSelect(env, 'odonto_manual_reports', `select=periode&periode=eq.${encodeURIComponent(periode)}`)) || [];
  if (existing.length) {
    await sbUpdate(
      env,
      'odonto_manual_reports',
      `periode=eq.${encodeURIComponent(periode)}`,
      { data, updated_by: userId || null },
      { returning: false }
    );
  } else {
    await sbInsert(env, 'odonto_manual_reports', [{ periode, data, updated_by: userId || null }], { returning: false });
  }
  return buildManualReport(env, 'month', periode);
}

// --- Agrégation (somme sur les mois de la période demandée) ---------------
function sumSections(defs, monthBlobs, sectionKey) {
  return defs.map((def) => {
    const row = emptyRow();
    for (const blob of monthBlobs) {
      const stored = blob && blob[sectionKey] && blob[sectionKey][def.id];
      if (!stored) continue;
      for (const ag of AGE_GROUPS) {
        const v = stored.parAge && stored.parAge[ag];
        if (!v) continue;
        row.parAge[ag].M += toNonNegInt(v.M);
        row.parAge[ag].F += toNonNegInt(v.F);
      }
      row.femmeEnceinte += toNonNegInt(stored.femmeEnceinte);
    }
    return finalizeRow(def.id, def.libelle, def.categorie ? { categorie: def.categorie } : {}, row);
  });
}

export async function buildManualReport(env, periodType, periodKey) {
  const months = periodMonths(periodType, periodKey);
  const { from, to } = periodRangeFromMonths(months);
  const defs = rowDefs();
  const monthBlobs = await Promise.all(months.map((m) => loadMonthRaw(env, m)));
  const moisSaisis = monthBlobs.filter((b) => b !== null).length;

  const morbidite = sumSections(defs.morbidite, monthBlobs, 'morbidite');
  const indicateursMorbidite = sumSections(defs.indicateursMorbidite, monthBlobs, 'indicateursMorbidite');
  const therapeutique = sumSections(defs.therapeutique, monthBlobs, 'therapeutique');
  const mortalite = sumSections(defs.mortalite, monthBlobs, 'mortalite');

  const consultRow = indicateursMorbidite.find((r) => r.id === 'CONSULTATIONS');

  return {
    periode: { type: periodType, key: periodKey, from, to, mois: months, moisSaisis },
    ageGroups: AGE_GROUPS,
    morbidite,
    indicateursMorbidite,
    therapeutique,
    mortalite,
    nbConsultations: consultRow ? consultRow.totaux.global : 0,
  };
}

export { AUTRES_DIAG_ID };
