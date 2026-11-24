// Transforme le résultat de reportBuilder.buildReport() en classeur .xlsx
// reproduisant la structure du rapport d'activité (mêmes sections, mêmes
// tranches d'âge/sexe, même colonne "Femme enceinte" que le modèle fourni).
'use strict';

import { buildWorkbook, colLetter } from './xlsxBuilder.js';
import { AGE_GROUPS } from '../ageGroups.js';

const NB_AGE = AGE_GROUPS.length; // 9
const TOTAL_COLS = 1 + NB_AGE * 2 + 2 + 1; // label + (M/F par tranche) + total M/F + femme enceinte
const COL_LABEL = 1;
const COL_TOTAL_M = 1 + NB_AGE * 2 + 1;
const COL_TOTAL_F = COL_TOTAL_M + 1;
const COL_ENCEINTE = COL_TOTAL_F + 1;

export class SheetBuilder {
  constructor() {
    this.rows = [];
    this.merges = [];
  }

  get currentRowNum() {
    return this.rows.length + 1;
  }

  pushRow(cells) {
    this.rows.push(cells);
    return this.currentRowNum - 1; // numéro de la ligne qui vient d'être ajoutée
  }

  emptyRowArray() {
    return new Array(TOTAL_COLS).fill(null);
  }

  addBlankRow() {
    this.pushRow(this.emptyRowArray());
  }

  addTitle(text) {
    const cells = this.emptyRowArray();
    cells[0] = { v: text, s: 2 };
    const r = this.pushRow(cells);
    this.merges.push(`A${r}:${colLetter(TOTAL_COLS)}${r}`);
  }

  addSectionTitle(text) {
    const cells = this.emptyRowArray();
    cells[0] = { v: text, s: 3 };
    for (let c = 2; c <= TOTAL_COLS; c++) cells[c - 1] = { v: '', s: 3 };
    const r = this.pushRow(cells);
    this.merges.push(`A${r}:${colLetter(TOTAL_COLS)}${r}`);
  }

  addSectionHeader(labelHeader) {
    const row1 = this.emptyRowArray();
    const row2 = this.emptyRowArray();

    row1[0] = { v: labelHeader, s: 1 };
    row2[0] = { s: 1 };

    for (let i = 0; i < NB_AGE; i++) {
      const colM = COL_LABEL + 1 + i * 2; // 1-based
      const colF = colM + 1;
      row1[colM - 1] = { v: AGE_GROUPS[i], s: 1 };
      row1[colF - 1] = { s: 1 };
      row2[colM - 1] = { v: 'M', s: 1 };
      row2[colF - 1] = { v: 'F', s: 1 };
    }

    row1[COL_TOTAL_M - 1] = { v: 'Total', s: 1 };
    row1[COL_TOTAL_F - 1] = { s: 1 };
    row2[COL_TOTAL_M - 1] = { v: 'M', s: 1 };
    row2[COL_TOTAL_F - 1] = { v: 'F', s: 1 };

    row1[COL_ENCEINTE - 1] = { v: 'Femme enceinte', s: 1 };
    row2[COL_ENCEINTE - 1] = { s: 1 };

    const hr1 = this.pushRow(row1);
    const hr2 = this.pushRow(row2);

    this.merges.push(`A${hr1}:A${hr2}`);
    for (let i = 0; i < NB_AGE; i++) {
      const colM = COL_LABEL + 1 + i * 2;
      const colF = colM + 1;
      this.merges.push(`${colLetter(colM)}${hr1}:${colLetter(colF)}${hr1}`);
    }
    this.merges.push(`${colLetter(COL_TOTAL_M)}${hr1}:${colLetter(COL_TOTAL_F)}${hr1}`);
    this.merges.push(`${colLetter(COL_ENCEINTE)}${hr1}:${colLetter(COL_ENCEINTE)}${hr2}`);
  }

  addDataRow(label, dataRow) {
    const cells = this.emptyRowArray();
    cells[COL_LABEL - 1] = { v: label, s: 5 };
    for (let i = 0; i < NB_AGE; i++) {
      const colM = COL_LABEL + 1 + i * 2;
      const colF = colM + 1;
      const counts = dataRow.parAge[AGE_GROUPS[i]] || { M: 0, F: 0 };
      cells[colM - 1] = { v: counts.M, t: 'num', s: 4 };
      cells[colF - 1] = { v: counts.F, t: 'num', s: 4 };
    }
    cells[COL_TOTAL_M - 1] = { v: dataRow.totaux.M, t: 'num', s: 6 };
    cells[COL_TOTAL_F - 1] = { v: dataRow.totaux.F, t: 'num', s: 6 };
    cells[COL_ENCEINTE - 1] = { v: dataRow.femmeEnceinte, t: 'num', s: 4 };
    this.pushRow(cells);
  }
}

export function morbiditeLabel(row) {
  if (!row.categorie || row.categorie === row.libelle) return row.libelle;
  return `${row.categorie} — ${row.libelle}`;
}

export { NB_AGE, TOTAL_COLS, COL_LABEL, COL_TOTAL_M, COL_TOTAL_F, COL_ENCEINTE };

export function buildReportWorkbook(report, meta) {
  const sb = new SheetBuilder();

  sb.addTitle('RAPPORT D’ACTIVITÉ MÉDICALE ET SANITAIRE — SERVICE D’ODONTO-STOMATOLOGIE');
  const sousTitre = buildSubtitle(meta, report);
  const stCells = sb.emptyRowArray();
  stCells[0] = { v: sousTitre, s: 0 };
  const r2 = sb.pushRow(stCells);
  sb.merges.push(`A${r2}:${colLetter(TOTAL_COLS)}${r2}`);
  sb.addBlankRow();

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

  const cols = [
    { min: 1, max: 1, width: 46 },
    { min: 2, max: 1 + NB_AGE * 2, width: 6.5 },
    { min: COL_TOTAL_M, max: COL_TOTAL_F, width: 8 },
    { min: COL_ENCEINTE, max: COL_ENCEINTE, width: 12 },
  ];

  return buildWorkbook({
    sheetName: 'Rapport odonto',
    rows: sb.rows,
    merges: sb.merges,
    cols,
  });
}

function buildSubtitle(meta, report) {
  const nomStructure = meta && meta.nomStructure ? `${meta.nomStructure} — ` : '';
  return `${nomStructure}Période : ${report.periode.from} au ${report.periode.to}  |  Consultations sur la période : ${report.nbConsultations}  |  Généré le ${new Date().toLocaleString('fr-FR')}`;
}
