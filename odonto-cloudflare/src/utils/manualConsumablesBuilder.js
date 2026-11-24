// Suivi mensuel de la disponibilité des consommables dentaires (cf.
// src/data/consommables.js) : Disponibilité (Oui/Non/NA) + nombre de jours
// de rupture de stock dans le mois. Comme pour le rapport d'activité manuel,
// les périodes trimestrielles/semestrielles/annuelles ne sont jamais
// ressaisies : elles sont calculées à partir des mois déjà saisis (somme des
// jours de rupture, détail mois par mois de la disponibilité). Version
// Cloudflare Worker : table Supabase odonto_manual_consumables.
'use strict';

import { HttpError } from '../router.js';
import { sbSelect, sbInsert, sbUpdate } from '../supabase.js';
import consommables from '../data/consommables.js';
import { periodMonths, periodRangeFromMonths } from './periodUtils.js';

const VALID_DISPO = new Set(['oui', 'non', 'na']);

function toNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

async function loadMonthRaw(env, periode) {
  const rows =
    (await sbSelect(env, 'odonto_manual_consumables', `select=data&periode=eq.${encodeURIComponent(periode)}`)) || [];
  if (!rows.length) return null;
  try {
    return typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
  } catch {
    return null;
  }
}

function sanitizeConsumablesPayload(payload) {
  const validIds = new Set(consommables.map((c) => c.id));
  const result = {};
  if (!payload || typeof payload !== 'object') return result;
  for (const [id, val] of Object.entries(payload)) {
    if (!validIds.has(id)) continue;
    const dispo = val && VALID_DISPO.has(val.disponibilite) ? val.disponibilite : null;
    result[id] = { disponibilite: dispo, joursRupture: toNonNegInt(val && val.joursRupture) };
  }
  return result;
}

export async function saveManualConsumablesMonth(env, periode, payload, userId) {
  if (!/^\d{4}-\d{2}$/.test(periode || '')) throw new HttpError(400, 'Période invalide (AAAA-MM attendu)');
  const data = sanitizeConsumablesPayload(payload);

  const existing =
    (await sbSelect(env, 'odonto_manual_consumables', `select=periode&periode=eq.${encodeURIComponent(periode)}`)) || [];
  if (existing.length) {
    await sbUpdate(
      env,
      'odonto_manual_consumables',
      `periode=eq.${encodeURIComponent(periode)}`,
      { data, updated_by: userId || null },
      { returning: false }
    );
  } else {
    await sbInsert(env, 'odonto_manual_consumables', [{ periode, data, updated_by: userId || null }], { returning: false });
  }
  return buildManualConsumables(env, 'month', periode);
}

export async function buildManualConsumables(env, periodType, periodKey) {
  const months = periodMonths(periodType, periodKey);
  const { from, to } = periodRangeFromMonths(months);
  const monthBlobs = await Promise.all(months.map(async (m) => ({ mois: m, data: await loadMonthRaw(env, m) })));
  const moisSaisis = monthBlobs.filter((m) => m.data !== null).length;

  const items = consommables.map((c) => {
    const detail = monthBlobs.map((m) => {
      const v = m.data && m.data[c.id];
      return { mois: m.mois, disponibilite: v ? v.disponibilite : null, joursRupture: v ? v.joursRupture : 0 };
    });
    const joursRuptureTotal = detail.reduce((sum, d) => sum + (d.joursRupture || 0), 0);
    const moisDisponible = detail.filter((d) => d.disponibilite === 'oui').length;
    const moisIndisponible = detail.filter((d) => d.disponibilite === 'non').length;
    const moisNonApplicable = detail.filter((d) => d.disponibilite === 'na').length;
    return {
      id: c.id,
      libelle: c.libelle,
      disponibilite: periodType === 'month' ? detail[0].disponibilite : null,
      joursRupture: periodType === 'month' ? detail[0].joursRupture : joursRuptureTotal,
      joursRuptureTotal,
      moisDisponible,
      moisIndisponible,
      moisNonApplicable,
      detail,
    };
  });

  return {
    periode: { type: periodType, key: periodKey, from, to, mois: months, moisSaisis },
    items,
  };
}
