'use strict';

import { HttpError, json, readJsonBody } from '../router.js';
import { requireAuth, requireRole } from '../auth.js';
import { sbSelect, sbInsert, sbUpdate } from '../supabase.js';
import { buildManualReport, saveManualReportMonth } from '../utils/manualReportBuilder.js';
import { buildManualConsumables, saveManualConsumablesMonth } from '../utils/manualConsumablesBuilder.js';
import { buildManualReportWorkbook } from '../utils/xlsx/manualReportExcel.js';
import { buildConsommablesWorkbook } from '../utils/xlsx/consommablesExcel.js';

const PERIOD_TYPES = new Set(['month', 'quarter', 'semester', 'year']);

function parsePeriodQuery(url) {
  const type = url.searchParams.get('type') || 'month';
  const key = url.searchParams.get('key');
  if (!PERIOD_TYPES.has(type)) throw new HttpError(400, 'Type de période invalide');
  if (!key) throw new HttpError(400, 'Paramètre key requis (ex: 2025-01, 2025-Q1, 2025-S1, 2025)');
  return { type, key };
}

function xlsxResponse(bytes, filename) {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
    },
  });
}

async function getSetting(env, key) {
  const rows = (await sbSelect(env, 'odonto_settings', `select=value&key=eq.${encodeURIComponent(key)}`)) || [];
  return rows.length ? rows[0].value || '' : '';
}

async function setSetting(env, key, value) {
  const existing = (await sbSelect(env, 'odonto_settings', `select=key&key=eq.${encodeURIComponent(key)}`)) || [];
  if (existing.length) {
    await sbUpdate(env, 'odonto_settings', `key=eq.${encodeURIComponent(key)}`, { value }, { returning: false });
  } else {
    await sbInsert(env, 'odonto_settings', [{ key, value }], { returning: false });
  }
}

export function register(router) {
  // --- Rapport d'activité : saisie directe -------------------------------
  router.get('/api/manual-reports', async (ctx) => {
    await requireAuth(ctx);
    const { type, key } = parsePeriodQuery(ctx.url);
    const report = await buildManualReport(ctx.env, type, key);
    return json(200, { report });
  });

  router.put('/api/manual-reports', async (ctx) => {
    const user = await requireAuth(ctx);
    const key = ctx.url.searchParams.get('key');
    if (!key) throw new HttpError(400, 'Paramètre key requis (ex: 2025-01)');
    const body = await readJsonBody(ctx.request);
    const report = await saveManualReportMonth(ctx.env, key, body, user.id);
    return json(200, { report });
  });

  router.get('/api/manual-reports/export', async (ctx) => {
    await requireAuth(ctx);
    const { type, key } = parsePeriodQuery(ctx.url);
    const report = await buildManualReport(ctx.env, type, key);
    const nomStructure = ctx.url.searchParams.get('structure') || (await getSetting(ctx.env, 'nomStructure'));
    const bytes = buildManualReportWorkbook(report, { nomStructure });
    return xlsxResponse(bytes, `rapport_mensuel_cabinet_dentaire_${key}.xlsx`);
  });

  // --- Consommables : saisie directe --------------------------------------
  router.get('/api/manual-consumables', async (ctx) => {
    await requireAuth(ctx);
    const { type, key } = parsePeriodQuery(ctx.url);
    const report = await buildManualConsumables(ctx.env, type, key);
    return json(200, { report });
  });

  router.put('/api/manual-consumables', async (ctx) => {
    const user = await requireAuth(ctx);
    const key = ctx.url.searchParams.get('key');
    if (!key) throw new HttpError(400, 'Paramètre key requis (ex: 2025-01)');
    const body = await readJsonBody(ctx.request);
    const report = await saveManualConsumablesMonth(ctx.env, key, body, user.id);
    return json(200, { report });
  });

  router.get('/api/manual-consumables/export', async (ctx) => {
    await requireAuth(ctx);
    const { type, key } = parsePeriodQuery(ctx.url);
    const report = await buildManualConsumables(ctx.env, type, key);
    const nomStructure = ctx.url.searchParams.get('structure') || (await getSetting(ctx.env, 'nomStructure'));
    const bytes = buildConsommablesWorkbook(report, { nomStructure });
    return xlsxResponse(bytes, `consommables_${key}.xlsx`);
  });

  // --- Paramètres (nom de la structure pour l'entête officiel) ------------
  router.get('/api/settings', async (ctx) => {
    await requireAuth(ctx);
    return json(200, { nomStructure: await getSetting(ctx.env, 'nomStructure') });
  });

  router.put('/api/settings', async (ctx) => {
    const user = await requireAuth(ctx);
    requireRole(user, 'admin');
    const body = await readJsonBody(ctx.request);
    await setSetting(ctx.env, 'nomStructure', String(body.nomStructure || '').trim());
    return json(200, { nomStructure: await getSetting(ctx.env, 'nomStructure') });
  });
}
