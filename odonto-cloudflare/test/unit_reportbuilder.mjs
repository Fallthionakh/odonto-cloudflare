// Test unitaire de reportBuilder.js / financialReportBuilder.js SANS réseau :
// on simule les réponses PostgREST (fetch) avec des données canned, pour
// vérifier uniquement la logique d'agrégation (tranches d'âge, totaux,
// ligne "Autres diagnostics", regroupement des caries par patient, etc.)
'use strict';

import { buildReport } from '../src/utils/reportBuilder.js';
import { buildFinancialReport } from '../src/utils/financialReportBuilder.js';

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`OK   ${label}`);
  else {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// Table bidon : patient 1 (F, née 1990-01-01, enceinte), patient 2 (M, né 2020-01-01)
const env = { SUPABASE_URL: 'https://fake.local', SUPABASE_SERVICE_ROLE_KEY: 'fake' };

globalThis.fetch = async (url) => {
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');

  if (table === 'odonto_consultation_diagnostics' && u.searchParams.has('pathologie_id')) {
    // cariesPatients : patient 1 a une carie permanente dans la période
    return jsonResponse([
      {
        pathologie_id: 'CARIES_PERM',
        odonto_consultations: {
          date_consultation: '2026-01-10',
          grossesse: true,
          patient_id: 1,
          odonto_patients: { sexe: 'F', date_naissance: '1990-01-01' },
        },
      },
    ]);
  }
  if (table === 'odonto_consultation_diagnostics') {
    // diagnostics posés : 1 carie (patiente 1), 1 diagnostic custom (patient 2)
    return jsonResponse([
      {
        pathologie_id: 'CARIES_PERM',
        odonto_consultations: { date_consultation: '2026-01-10', grossesse: true, odonto_patients: { sexe: 'F', date_naissance: '1990-01-01' } },
      },
      {
        pathologie_id: 'CUSTOM_TEST',
        odonto_consultations: { date_consultation: '2026-01-12', grossesse: false, odonto_patients: { sexe: 'M', date_naissance: '2020-01-01' } },
      },
    ]);
  }
  if (table === 'odonto_consultation_traitements') {
    return jsonResponse([
      {
        traitement_id: 'EXTRACT_SIMPLE',
        odonto_consultations: { date_consultation: '2026-01-10', grossesse: true, odonto_patients: { sexe: 'F', date_naissance: '1990-01-01' } },
      },
    ]);
  }
  if (table === 'odonto_consultations') {
    return jsonResponse([
      {
        id: 10,
        patient_id: 1,
        date_consultation: '2026-01-10',
        type_cas: 'nouveau',
        statut_reference: 'refere',
        grossesse: true,
        issue: 'vivant',
        type_paiement: 'PAF',
        montant_prise_en_charge: 15000,
        montant_patient_paye: 2000,
        odonto_patients: { sexe: 'F', date_naissance: '1990-01-01' },
      },
      {
        id: 11,
        patient_id: 2,
        date_consultation: '2026-01-12',
        type_cas: 'ancien',
        statut_reference: 'aucun',
        grossesse: false,
        issue: 'decede',
        cause_deces_id: 'NOMA',
        type_paiement: 'LG',
        montant_prise_en_charge: 5000,
        montant_patient_paye: 1000,
        odonto_patients: { sexe: 'M', date_naissance: '2020-01-01' },
      },
    ]);
  }
  if (table === 'odonto_custom_pathologies') {
    return jsonResponse([{ id: 'CUSTOM_TEST', libelle: 'Test', categorie: 'Autres (ajoutés)' }]);
  }
  throw new Error(`endpoint non simulé dans ce test : ${table}`);
};

async function main() {
  const report = await buildReport(env, '2026-01-01', '2026-01-31');

  check('nbConsultations = 2', report.nbConsultations === 2);

  const cariesLine = report.morbidite.find((r) => r.id === 'CARIES_PERM');
  check('CARIES_PERM compté 1 fois, tranche 25-49 ans, F', cariesLine.totaux.F === 1 && cariesLine.parAge['25-49 ans'].F === 1);
  check('femme enceinte comptée sur la ligne CARIES_PERM', cariesLine.femmeEnceinte === 1);

  const autresLine = report.morbidite.find((r) => r.id === 'AUTRES_DIAG');
  check('diagnostic personnalisé regroupé dans "Autres diagnostics" (ligne visible)', !!autresLine && autresLine.totaux.M === 1);

  const casRefere = report.indicateursMorbidite.find((r) => r.id === 'CAS_REFERES');
  check('1 cas référé compté', casRefere.totaux.global === 1);

  const casCarie = report.indicateursMorbidite.find((r) => r.id === 'CAS_CARIE');
  check('1 personne distincte avec carie (regroupement JS du GROUP BY)', casCarie.totaux.global === 1);

  const extraction = report.therapeutique.find((r) => r.id === 'EXTRACT_SIMPLE');
  check('1 extraction simple comptée', extraction.totaux.global === 1);

  const noma = report.mortalite.find((r) => r.id === 'NOMA');
  check('1 décès par Noma compté (tranche 5-9ans, M)', noma.totaux.M === 1 && noma.parAge['5-9ans'].M === 1);

  const fin = await buildFinancialReport(env, '2026-01-01', '2026-01-31');
  check('total général financier = 23000', fin.totalGeneral === 23000);
  check('2 types de paiement utilisés (PAF + LG)', fin.parType.filter((p) => p.nb > 0).length === 2);

  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS SONT PASSÉS' : `${failures} ÉCHEC(S)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERREUR INATTENDUE:', err);
  process.exit(1);
});
