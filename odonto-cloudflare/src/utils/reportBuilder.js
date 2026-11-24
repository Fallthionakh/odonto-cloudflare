// Agrège les consultations d'une période donnée dans la structure exacte du
// rapport d'activité mensuel (Synthèse de Morbidité / Rapport de morbidité du
// cabinet dentaire / Rapport thérapeutique / Rapport de Mortalité).
// Version Cloudflare Worker : les données viennent de Supabase (PostgREST)
// au lieu de SQLite ; les jointures SQL sont remplacées par l'« embedding »
// PostgREST (`table!inner(...)`) et les agrégations GROUP BY (cas des caries)
// sont faites en JavaScript après récupération des lignes filtrées.
'use strict';

import { sbSelect } from '../supabase.js';
import { AGE_GROUPS, computeAgeGroup } from './ageGroups.js';
import pathologies from '../data/pathologies.js';
import treatments from '../data/treatments.js';
import indicateurs from '../data/indicateurs.js';
import { STATIC_PATHOLOGIE_IDS, STATIC_TRAITEMENT_IDS, customPathologieIds } from './customReference.js';

const AUTRES_DIAG_ID = 'AUTRES_DIAG';

function emptyRow() {
  const row = { parAge: {}, femmeEnceinte: 0 };
  for (const ag of AGE_GROUPS) row.parAge[ag] = { M: 0, F: 0 };
  return row;
}

function addToRow(row, ageGroup, sexe, grossesse) {
  if (!row.parAge[ageGroup]) row.parAge[ageGroup] = { M: 0, F: 0 };
  if (sexe !== 'M' && sexe !== 'F') return;
  row.parAge[ageGroup][sexe] += 1;
  if (sexe === 'F' && grossesse) row.femmeEnceinte += 1;
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

function dateRangeQuery(column, from, to) {
  return `${column}=gte.${encodeURIComponent(from)}&${column}=lte.${encodeURIComponent(to)}`;
}

export async function buildReport(env, from, to) {
  // --- Synthèse de morbidité (diagnostics posés) ---
  const morbiditeRows = {};
  for (const p of pathologies) morbiditeRows[p.id] = emptyRow();
  morbiditeRows[AUTRES_DIAG_ID] = emptyRow();

  const diagRowsRaw =
    (await sbSelect(
      env,
      'odonto_consultation_diagnostics',
      `select=pathologie_id,odonto_consultations!inner(date_consultation,grossesse,odonto_patients!inner(sexe,date_naissance))&${dateRangeQuery(
        'odonto_consultations.date_consultation',
        from,
        to
      )}`
    )) || [];

  for (const r of diagRowsRaw) {
    const c = r.odonto_consultations;
    const p = c && c.odonto_patients;
    if (!c || !p) continue;
    const key = STATIC_PATHOLOGIE_IDS.has(r.pathologie_id) ? r.pathologie_id : AUTRES_DIAG_ID;
    const row = morbiditeRows[key];
    if (!row) continue;
    const ageGroup = computeAgeGroup(p.date_naissance, c.date_consultation);
    addToRow(row, ageGroup, p.sexe, !!c.grossesse);
  }

  const morbidite = pathologies.map((p) =>
    finalizeRow(p.id, p.libelle || p.categorie, { categorie: p.categorie }, morbiditeRows[p.id])
  );
  // La ligne « Autres diagnostics » n'apparaît que si des diagnostics
  // personnalisés ont déjà été ajoutés au moins une fois, pour que le
  // rapport reste identique au modèle officiel tant que la fonctionnalité
  // n'est pas utilisée.
  if ((await customPathologieIds(env)).size > 0) {
    morbidite.push(
      finalizeRow(
        AUTRES_DIAG_ID,
        'Autres diagnostics (ajoutés)',
        { categorie: 'Autres diagnostics (ajoutés)' },
        morbiditeRows[AUTRES_DIAG_ID]
      )
    );
  }

  // --- Rapport de morbidité du cabinet dentaire (indicateurs de fréquentation) ---
  const consultations =
    (await sbSelect(
      env,
      'odonto_consultations',
      `select=*,odonto_patients(sexe,date_naissance)&${dateRangeQuery('date_consultation', from, to)}`
    )) || [];

  const indicRows = {};
  for (const ind of indicateurs.morbidite) indicRows[ind.id] = emptyRow();

  for (const c of consultations) {
    const p = c.odonto_patients || {};
    const ageGroup = computeAgeGroup(p.date_naissance, c.date_consultation);
    addToRow(indicRows.CONSULTATIONS, ageGroup, p.sexe, !!c.grossesse);
    if (c.type_cas === 'nouveau') addToRow(indicRows.NOUVEAUX_CAS, ageGroup, p.sexe, !!c.grossesse);
    if (c.statut_reference === 'refere') addToRow(indicRows.CAS_REFERES, ageGroup, p.sexe, !!c.grossesse);
    if (c.statut_reference === 'contre_refere') addToRow(indicRows.CAS_CONTRE_REFERES, ageGroup, p.sexe, !!c.grossesse);
    if (c.statut_reference === 'vu_par_reference') addToRow(indicRows.CAS_VUS_PAR_REFERENCE, ageGroup, p.sexe, !!c.grossesse);
  }

  // Personnes distinctes avec au moins une carie dentaire dans la période
  // (agrégation faite ici en JS : PostgREST ne permet pas un GROUP BY arbitraire).
  const cariesRowsRaw =
    (await sbSelect(
      env,
      'odonto_consultation_diagnostics',
      `select=pathologie_id,odonto_consultations!inner(date_consultation,grossesse,patient_id,odonto_patients!inner(sexe,date_naissance))&pathologie_id=in.(CARIES_TEMP,CARIES_PERM)&${dateRangeQuery(
        'odonto_consultations.date_consultation',
        from,
        to
      )}`
    )) || [];

  const cariesByPatient = new Map();
  for (const r of cariesRowsRaw) {
    const c = r.odonto_consultations;
    if (!c) continue;
    const prev = cariesByPatient.get(c.patient_id);
    if (!prev || c.date_consultation < prev.first_date) {
      cariesByPatient.set(c.patient_id, {
        first_date: prev ? (c.date_consultation < prev.first_date ? c.date_consultation : prev.first_date) : c.date_consultation,
        grossesse: (prev && prev.grossesse) || !!c.grossesse,
        sexe: c.odonto_patients.sexe,
        date_naissance: c.odonto_patients.date_naissance,
      });
    } else {
      prev.grossesse = prev.grossesse || !!c.grossesse;
    }
  }
  for (const cp of cariesByPatient.values()) {
    const ageGroup = computeAgeGroup(cp.date_naissance, cp.first_date);
    addToRow(indicRows.CAS_CARIE, ageGroup, cp.sexe, !!cp.grossesse);
  }

  const indicateursMorbidite = indicateurs.morbidite.map((ind) => finalizeRow(ind.id, ind.libelle, {}, indicRows[ind.id]));

  // --- Rapport thérapeutique ---
  const traitRows = {};
  for (const t of treatments) traitRows[t.id] = emptyRow();

  const traitementRowsRaw =
    (await sbSelect(
      env,
      'odonto_consultation_traitements',
      `select=traitement_id,odonto_consultations!inner(date_consultation,grossesse,odonto_patients!inner(sexe,date_naissance))&${dateRangeQuery(
        'odonto_consultations.date_consultation',
        from,
        to
      )}`
    )) || [];

  for (const r of traitementRowsRaw) {
    const c = r.odonto_consultations;
    const p = c && c.odonto_patients;
    if (!c || !p) continue;
    // Un traitement ajouté à la volée est compté dans la ligne « Autres »
    // déjà prévue par le modèle, pour ne pas modifier sa structure fixe.
    const key = STATIC_TRAITEMENT_IDS.has(r.traitement_id) ? r.traitement_id : 'AUTRES';
    const row = traitRows[key];
    if (!row) continue;
    const ageGroup = computeAgeGroup(p.date_naissance, c.date_consultation);
    addToRow(row, ageGroup, p.sexe, !!c.grossesse);
  }

  const therapeutique = treatments.map((t) => finalizeRow(t.id, t.libelle, {}, traitRows[t.id]));

  // --- Rapport de mortalité ---
  const mortRows = {};
  for (const m of indicateurs.mortalite) mortRows[m.id] = emptyRow();

  const deces = consultations.filter((c) => c.issue === 'decede' && mortRows[c.cause_deces_id]);
  for (const d of deces) {
    const p = d.odonto_patients || {};
    const ageGroup = computeAgeGroup(p.date_naissance, d.date_consultation);
    addToRow(mortRows[d.cause_deces_id], ageGroup, p.sexe, !!d.grossesse);
  }

  const mortalite = indicateurs.mortalite.map((m) => finalizeRow(m.id, m.libelle, {}, mortRows[m.id]));

  return {
    periode: { from, to },
    ageGroups: AGE_GROUPS,
    morbidite,
    indicateursMorbidite,
    therapeutique,
    mortalite,
    nbConsultations: consultations.length,
  };
}
