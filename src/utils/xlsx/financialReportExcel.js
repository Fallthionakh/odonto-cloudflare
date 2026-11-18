// Transforme le résultat de financialReportBuilder.buildFinancialReport()
// en classeur .xlsx : un tableau simple (type de paiement, nb consultations,
// montant pris en charge, montant payé par le patient, total).
'use strict';

import { buildWorkbook, colLetter } from './xlsxBuilder.js';

const TOTAL_COLS = 5;
const HEADERS = ['Type de paiement', 'Nb consultations', 'Montant pris en charge', 'Montant payé par le patient', 'Total'];

function emptyRow() {
  return new Array(TOTAL_COLS).fill(null);
}

export function buildFinancialReportWorkbook(report, meta) {
  const rows = [];
  const merges = [];

  function push(cells) {
    rows.push(cells);
    return rows.length;
  }

  let cells = emptyRow();
  cells[0] = { v: 'RAPPORT FINANCIER — SERVICE D’ODONTO-STOMATOLOGIE', s: 2 };
  let r = push(cells);
  merges.push(`A${r}:${colLetter(TOTAL_COLS)}${r}`);

  const nomStructure = meta && meta.nomStructure ? `${meta.nomStructure} — ` : '';
  cells = emptyRow();
  cells[0] = {
    v: `${nomStructure}Période : ${report.periode.from} au ${report.periode.to}  |  Généré le ${new Date().toLocaleString('fr-FR')}`,
    s: 0,
  };
  r = push(cells);
  merges.push(`A${r}:${colLetter(TOTAL_COLS)}${r}`);

  push(emptyRow());

  push(HEADERS.map((h) => ({ v: h, s: 1 })));

  for (const row of report.parType) {
    push([
      { v: row.libelle, s: 5 },
      { v: row.nb, t: 'num', s: 4 },
      { v: row.montantPriseEnCharge, t: 'num', s: 4 },
      { v: row.montantPatientPaye, t: 'num', s: 4 },
      { v: row.total, t: 'num', s: 6 },
    ]);
  }

  push([
    { v: 'TOTAL GÉNÉRAL', s: 6 },
    { v: report.nbConsultationsAvecPaiement, t: 'num', s: 6 },
    { v: report.totalPriseEnCharge, t: 'num', s: 6 },
    { v: report.totalPatientPaye, t: 'num', s: 6 },
    { v: report.totalGeneral, t: 'num', s: 6 },
  ]);

  const cols = [
    { min: 1, max: 1, width: 32 },
    { min: 2, max: 2, width: 16 },
    { min: 3, max: 5, width: 24 },
  ];

  return buildWorkbook({ sheetName: 'Rapport financier', rows, merges, cols });
}
