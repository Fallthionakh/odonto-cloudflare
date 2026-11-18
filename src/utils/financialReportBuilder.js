// Agrège les consultations d'une période donnée pour le rapport financier :
// montant total encaissé et répartition par type de paiement (PAF, LG,
// PERSONNEL, CAS_SOCIAL), avec pour chacun le montant pris en charge
// (part employeur / montant social / montant PAF selon le type) et le
// montant payé par le patient.
'use strict';

import { sbSelect } from '../supabase.js';

export const PAIEMENT_TYPES_INFO = {
  PAF: { libelle: 'PAF', labelPriseEnCharge: 'Montant de la prise en charge' },
  LG: { libelle: 'LG (Lettre de garantie)', labelPriseEnCharge: 'Part employeur' },
  PERSONNEL: { libelle: 'Personnel', labelPriseEnCharge: null },
  CAS_SOCIAL: { libelle: 'Cas social', labelPriseEnCharge: 'Montant social' },
};
export const TYPE_ORDER = ['PAF', 'LG', 'PERSONNEL', 'CAS_SOCIAL'];

export async function buildFinancialReport(env, from, to) {
  const rows =
    (await sbSelect(
      env,
      'odonto_consultations',
      `select=type_paiement,montant_prise_en_charge,montant_patient_paye&type_paiement=not.is.null&date_consultation=gte.${encodeURIComponent(
        from
      )}&date_consultation=lte.${encodeURIComponent(to)}`
    )) || [];

  const byType = {};
  for (const t of TYPE_ORDER) byType[t] = { nb: 0, montantPriseEnCharge: 0, montantPatientPaye: 0 };

  for (const r of rows) {
    const bucket = byType[r.type_paiement];
    if (!bucket) continue; // type inconnu (donnée historique) : ignoré
    bucket.nb += 1;
    bucket.montantPriseEnCharge += r.montant_prise_en_charge || 0;
    bucket.montantPatientPaye += r.montant_patient_paye || 0;
  }

  const parType = TYPE_ORDER.map((id) => {
    const b = byType[id];
    const info = PAIEMENT_TYPES_INFO[id];
    return {
      id,
      libelle: info.libelle,
      labelPriseEnCharge: info.labelPriseEnCharge,
      nb: b.nb,
      montantPriseEnCharge: b.montantPriseEnCharge,
      montantPatientPaye: b.montantPatientPaye,
      total: b.montantPriseEnCharge + b.montantPatientPaye,
    };
  });

  const totalPriseEnCharge = parType.reduce((s, r) => s + r.montantPriseEnCharge, 0);
  const totalPatientPaye = parType.reduce((s, r) => s + r.montantPatientPaye, 0);
  const totalGeneral = totalPriseEnCharge + totalPatientPaye;
  const nbConsultationsAvecPaiement = parType.reduce((s, r) => s + r.nb, 0);

  return {
    periode: { from, to },
    parType,
    totalPriseEnCharge,
    totalPatientPaye,
    totalGeneral,
    nbConsultationsAvecPaiement,
  };
}
