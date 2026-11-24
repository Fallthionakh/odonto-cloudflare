'use strict';

import { HttpError, json } from '../router.js';
import { requireAuth } from '../auth.js';
import { buildReport } from '../utils/reportBuilder.js';
import { buildReportWorkbook } from '../utils/xlsx/reportExcel.js';
import { buildFinancialReport } from '../utils/financialReportBuilder.js';
import { buildFinancialReportWorkbook } from '../utils/xlsx/financialReportExcel.js';

function parsePeriod(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) throw new HttpError(400, 'Paramètres from et to requis (format AAAA-MM-JJ)');
  const df = new Date(from);
  const dt = new Date(to);
  if (Number.isNaN(df.getTime()) || Number.isNaN(dt.getTime())) throw new HttpError(400, 'Dates invalides');
  if (df > dt) throw new HttpError(400, 'La date de début doit précéder la date de fin');
  return { from, to };
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

export function register(router) {
  router.get('/api/reports', async (ctx) => {
    await requireAuth(ctx);
    const { from, to } = parsePeriod(ctx.url);
    const report = await buildReport(ctx.env, from, to);
    return json(200, { report });
  });

  router.get('/api/reports/export', async (ctx) => {
    await requireAuth(ctx);
    const { from, to } = parsePeriod(ctx.url);
    const report = await buildReport(ctx.env, from, to);
    const nomStructure = ctx.url.searchParams.get('structure') || ctx.env.ODONTO_NOM_STRUCTURE || '';
    const bytes = buildReportWorkbook(report, { nomStructure });
    return xlsxResponse(bytes, `rapport_odonto_${from}_au_${to}.xlsx`);
  });

  router.get('/api/reports/financial', async (ctx) => {
    await requireAuth(ctx);
    const { from, to } = parsePeriod(ctx.url);
    const report = await buildFinancialReport(ctx.env, from, to);
    return json(200, { report });
  });

  router.get('/api/reports/financial/export', async (ctx) => {
    await requireAuth(ctx);
    const { from, to } = parsePeriod(ctx.url);
    const report = await buildFinancialReport(ctx.env, from, to);
    const nomStructure = ctx.url.searchParams.get('structure') || ctx.env.ODONTO_NOM_STRUCTURE || '';
    const bytes = buildFinancialReportWorkbook(report, { nomStructure });
    return xlsxResponse(bytes, `rapport_financier_odonto_${from}_au_${to}.xlsx`);
  });
}
