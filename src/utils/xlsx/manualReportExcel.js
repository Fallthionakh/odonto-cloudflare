// Export Excel du rapport d'activité en mode « saisie directe », avec
// l'entête officiel du Ministère de la Santé et de l'Action Sociale
// (Direction de la Lutte contre la Maladie / Division de la Santé
// Bucco-Dentaire). Réutilise le même moteur de feuille que le rapport
// automatique (reportExcel.js) : mêmes sections, mêmes tranches d'âge/sexe,
// mêmes totaux — seule l'entête change. Identique à odonto-app en logique,
// adapté en ESM.
'use strict';

import { buildWorkbook, colLetter } from './xlsxBuilder.js';
import { SheetBuilder, morbiditeLabel, TOTAL_COLS } from './reportExcel.js';

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export function periodLabel(periode) {
  const { type, key } = periode || {};
  if (type === 'month' && /^\d{4}-\d{2}$/.test(key || '')) {
    const [y, m] = key.split('-').map(Number);
    return `${MONTH_NAMES_FR[m - 1]} ${y}`;
  }
  if (type === 'quarter') {
    const [y, q] = (key || '').split('-Q');
    return `${q}${q === '1' ? 'er' : 'ème'} trimestre ${y}`;
  }
  if (type === 'semester') {
    const [y, s] = (key || '').split('-S');
    return `${s}${s === '1' ? 'er' : 'ème'} semestre ${y}`;
  }
  if (type === 'year') return `Année ${key}`;
  return key || '';
}

export function reportTitle(type) {
  if (type === 'quarter') return 'RAPPORT TRIMESTRIEL CABINET DENTAIRE';
  if (type === 'semester') return 'RAPPORT SEMESTRIEL CABINET DENTAIRE';
  if (type === 'year') return 'RAPPORT ANNUEL CABINET DENTAIRE';
  return 'RAPPORT MENSUEL CABINET DENTAIRE';
}

function addCenteredLine(sb, text, style) {
  const cells = sb.emptyRowArray();
  cells[0] = { v: text, s: style };
  const r = sb.pushRow(cells);
  sb.merges.push(`A${r}:${colLetter(TOTAL_COLS)}${r}`);
}

function addLetterhead(sb, meta, report) {
  addCenteredLine(sb, 'RÉPUBLIQUE DU SÉNÉGAL', 0);
  addCenteredLine(sb, 'Un Peuple - Un But - Une Foi', 0);
  addCenteredLine(sb, "MINISTÈRE DE LA SANTÉ ET DE L'ACTION SOCIALE", 0);
  addCenteredLine(sb, 'DIRECTION GÉNÉRALE DE LA SANTÉ', 0);
  addCenteredLine(sb, 'DIRECTION DE LA LUTTE CONTRE LA MALADIE', 0);
  addCenteredLine(sb, 'DIVISION DE LA SANTÉ BUCCO-DENTAIRE', 0);
  sb.addBlankRow();
  addCenteredLine(sb, reportTitle(report.periode && report.periode.type), 2);
  const nomStructure = meta && meta.nomStructure ? meta.nomStructure : '(non renseigné)';
  addCenteredLine(sb, `Nom de la structure : ${nomStructure}`, 0);
  addCenteredLine(sb, `Période : ${periodLabel(report.periode)}`, 0);
  const moisInfo =
    report.periode && report.periode.mois && report.periode.mois.length > 1
      ? ` (${report.periode.moisSaisis}/${report.periode.mois.length} mois saisis, du ${report.periode.from} au ${report.periode.to})`
      : '';
  addCenteredLine(sb, `Consultations sur la période : ${report.nbConsultations}${moisInfo} — Généré le ${new Date().toLocaleString('fr-FR')}`, 0);
  sb.addBlankRow();
}

export function buildManualReportWorkbook(report, meta) {
  const sb = new SheetBuilder();

  addLetterhead(sb, meta, report);

  sb.addSectionTitle('Synthèse de Morbidité');
  sb.addSectionHeader('Affections / Troubles');
  for (const row of report.morbidite) sb.addDataRow(morbiditeLabel(row), row);
  sb.addBlankRow();

  sb.addSectionTitle('Rapport de morbidité du cabinet dentaire');
  sb.addSectionHeader('Morbidité');
  for (const row of report.indicateursMorbidite) sb.addDataRow(row.libelle, row);
  sb.addBlankRow();

  sb.addSectionTitle('Rapport thérapeutique');
  sb.addSectionHeader('Traitements effectués');
  for (const row of report.therapeutique) sb.addDataRow(row.libelle, row);
  sb.addBlankRow();

  sb.addSectionTitle('Rapport de Mortalité');
  sb.addSectionHeader('Affections');
  for (const row of report.mortalite) sb.addDataRow(row.libelle, row);

  const NB_AGE_COLS = TOTAL_COLS - 4; // 1 label + (NB_AGE*2) + 2 total + 1 enceinte
  const cols = [
    { min: 1, max: 1, width: 46 },
    { min: 2, max: 1 + NB_AGE_COLS, width: 6.5 },
    { min: TOTAL_COLS - 2, max: TOTAL_COLS - 1, width: 8 },
    { min: TOTAL_COLS, max: TOTAL_COLS, width: 12 },
  ];

  return buildWorkbook({
    sheetName: 'Rapport mensuel',
    rows: sb.rows,
    merges: sb.merges,
    cols,
  });
}
