// Résolution des périodes de saisie directe (mois / trimestre / semestre /
// année) en liste de mois 'AAAA-MM', partagée par manualReportBuilder.js et
// manualConsumablesBuilder.js. Identique à odonto-app/src/utils/periodUtils.js.
'use strict';

import { HttpError } from '../router.js';

// type: 'month' | 'quarter' | 'semester' | 'year'
// key : 'AAAA-MM' | 'AAAA-Q1'..'Q4' | 'AAAA-S1'/'S2' | 'AAAA'
export function periodMonths(type, key) {
  if (type === 'month') {
    if (!/^\d{4}-\d{2}$/.test(key || '')) throw new HttpError(400, 'Période mois invalide (AAAA-MM attendu)');
    return [key];
  }
  if (type === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(key || '');
    if (!m) throw new HttpError(400, 'Période trimestre invalide (AAAA-Q1 à AAAA-Q4 attendu)');
    const year = m[1];
    const start = (Number(m[2]) - 1) * 3 + 1;
    return [start, start + 1, start + 2].map((mo) => `${year}-${String(mo).padStart(2, '0')}`);
  }
  if (type === 'semester') {
    const m = /^(\d{4})-S([1-2])$/.exec(key || '');
    if (!m) throw new HttpError(400, 'Période semestre invalide (AAAA-S1 ou AAAA-S2 attendu)');
    const year = m[1];
    const start = m[2] === '1' ? 1 : 7;
    return Array.from({ length: 6 }, (_, i) => `${year}-${String(start + i).padStart(2, '0')}`);
  }
  if (type === 'year') {
    if (!/^\d{4}$/.test(key || '')) throw new HttpError(400, 'Période année invalide (AAAA attendu)');
    return Array.from({ length: 12 }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
  }
  throw new HttpError(400, "Type de période invalide (attendu : month, quarter, semester, year)");
}

export function periodRangeFromMonths(months) {
  const ly = Number(months[months.length - 1].split('-')[0]);
  const lm = Number(months[months.length - 1].split('-')[1]);
  const from = `${months[0]}-01`;
  const to = new Date(ly, lm, 0).toISOString().slice(0, 10);
  return { from, to };
}
