// Export Excel du suivi des consommables dentaires (disponibilité + jours de
// rupture de stock), avec le même entête officiel que le rapport mensuel.
'use strict';

import { buildWorkbook, colLetter } from './xlsxBuilder.js';
import { periodLabel } from './manualReportExcel.js';

const TOTAL_COLS = 3;
const DISPO_LABELS = { oui: 'Oui', non: 'Non', na: 'N/A' };

class SimpleSheetBuilder {
  constructor() {
    this.rows = [];
    this.merges = [];
  }

  get currentRowNum() {
    return this.rows.length + 1;
  }

  emptyRowArray() {
    return new Array(TOTAL_COLS).fill(null);
  }

  pushRow(cells) {
    this.rows.push(cells);
    return this.currentRowNum - 1;
  }

  addBlankRow() {
    this.pushRow(this.emptyRowArray());
  }

  addCenteredLine(text, style) {
    const cells = this.emptyRowArray();
    cells[0] = { v: text, s: style };
    const r = this.pushRow(cells);
    this.merges.push(`A${r}:${colLetter(TOTAL_COLS)}${r}`);
  }

  addHeaderRow() {
    const cells = this.emptyRowArray();
    cells[0] = { v: 'Consommable', s: 1 };
    cells[1] = { v: 'Disponibilité', s: 1 };
    cells[2] = { v: 'Nombre de jours de rupture', s: 1 };
    this.pushRow(cells);
  }

  addDataRow(libelle, dispoText, joursRupture) {
    const cells = this.emptyRowArray();
    cells[0] = { v: libelle, s: 5 };
    cells[1] = { v: dispoText, s: 4 };
    cells[2] = { v: joursRupture, t: 'num', s: 4 };
    this.pushRow(cells);
  }
}

function dispoText(item, isMonth) {
  if (isMonth) {
    return item.disponibilite ? DISPO_LABELS[item.disponibilite] || '—' : '—';
  }
  const total = item.moisDisponible + item.moisIndisponible + item.moisNonApplicable;
  if (total === 0) return 'Aucune saisie';
  const parts = [];
  if (item.moisDisponible) parts.push(`Oui: ${item.moisDisponible} mois`);
  if (item.moisIndisponible) parts.push(`Non: ${item.moisIndisponible} mois`);
  if (item.moisNonApplicable) parts.push(`N/A: ${item.moisNonApplicable} mois`);
  return parts.join(' · ');
}

export function buildConsommablesWorkbook(report, meta) {
  const sb = new SimpleSheetBuilder();
  const isMonth = report.periode.type === 'month';

  sb.addCenteredLine('RÉPUBLIQUE DU SÉNÉGAL', 0);
  sb.addCenteredLine('Un Peuple - Un But - Une Foi', 0);
  sb.addCenteredLine("MINISTÈRE DE LA SANTÉ ET DE L'ACTION SOCIALE", 0);
  sb.addCenteredLine('DIRECTION GÉNÉRALE DE LA SANTÉ', 0);
  sb.addCenteredLine('DIRECTION DE LA LUTTE CONTRE LA MALADIE', 0);
  sb.addCenteredLine('DIVISION DE LA SANTÉ BUCCO-DENTAIRE', 0);
  sb.addBlankRow();
  sb.addCenteredLine('SUIVI DES CONSOMMABLES — CABINET DENTAIRE', 2);
  const nomStructure = meta && meta.nomStructure ? meta.nomStructure : '(non renseigné)';
  sb.addCenteredLine(`Nom de la structure : ${nomStructure}`, 0);
  sb.addCenteredLine(`Période : ${periodLabel(report.periode)}`, 0);
  sb.addBlankRow();

  sb.addHeaderRow();
  for (const item of report.items) {
    sb.addDataRow(item.libelle, dispoText(item, isMonth), isMonth ? item.joursRupture : item.joursRuptureTotal);
  }

  const cols = [
    { min: 1, max: 1, width: 46 },
    { min: 2, max: 2, width: 30 },
    { min: 3, max: 3, width: 24 },
  ];

  return buildWorkbook({ sheetName: 'Consommables', rows: sb.rows, merges: sb.merges, cols });
}
