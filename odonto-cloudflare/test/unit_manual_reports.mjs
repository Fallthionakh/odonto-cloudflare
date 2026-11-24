// Test du mode de saisie directe (manuelle) du rapport d'activité et du
// suivi des consommables (version Cloudflare Worker), SANS réseau : simule
// Supabase/PostgREST en mémoire (même principe que unit_import.mjs).
// Lancer avec : node test/unit_manual_reports.mjs
'use strict';

// --- Base PostgREST simulée en mémoire -----------------------------------
const store = {
  odonto_manual_reports: [],
  odonto_manual_consumables: [],
  odonto_settings: [],
};

function parseFilters(search) {
  const filters = [];
  for (const [key, val] of search.entries()) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    const m = /^eq\.(.*)$/.exec(val);
    if (m) filters.push({ field: key, value: decodeURIComponent(m[1]) });
  }
  return filters;
}
function matchesFilters(row, filters) {
  return filters.every((f) => String(row[f.field]) === f.value);
}

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  if (!(table in store)) throw new Error(`table non simulée : ${table}`);
  const method = (opts.method || 'GET').toUpperCase();

  if (method === 'GET') {
    const rows = store[table].filter((r) => matchesFilters(r, parseFilters(u.searchParams)));
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'POST') {
    const bodyRows = JSON.parse(opts.body);
    const inserted = bodyRows.map((row) => {
      const copy = { ...row };
      store[table].push(copy);
      return copy;
    });
    const preferMinimal = (opts.headers.Prefer || '') === 'return=minimal';
    return new Response(preferMinimal ? '' : JSON.stringify(inserted), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'PATCH') {
    const filters = parseFilters(u.searchParams);
    const patch = JSON.parse(opts.body);
    const updated = [];
    for (const row of store[table]) {
      if (matchesFilters(row, filters)) {
        Object.assign(row, patch);
        updated.push(row);
      }
    }
    return new Response(JSON.stringify(updated), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`méthode non simulée : ${method}`);
};

const env = { SUPABASE_URL: 'https://fake.local', SUPABASE_SERVICE_ROLE_KEY: 'fake' };

let failures = 0;
function check(label, cond) {
  if (cond) console.log('OK  ', label);
  else { console.error('FAIL', label); failures += 1; }
}

async function main() {
  const { buildManualReport, saveManualReportMonth } = await import('../src/utils/manualReportBuilder.js');
  const { buildManualConsumables, saveManualConsumablesMonth } = await import('../src/utils/manualConsumablesBuilder.js');
  const { buildManualReportWorkbook } = await import('../src/utils/xlsx/manualReportExcel.js');
  const { buildConsommablesWorkbook } = await import('../src/utils/xlsx/consommablesExcel.js');

  await saveManualReportMonth(env, '2025-01', {
    morbidite: { CARIES_TEMP: { parAge: { '0-11 mois': { M: 2, F: 1 } }, femmeEnceinte: 0 } },
    indicateursMorbidite: { CONSULTATIONS: { parAge: { '20-24 ans': { M: 5, F: 3 } }, femmeEnceinte: 1 } },
    therapeutique: { EXTRACT_SIMPLE: { parAge: { '25-49 ans': { M: 1, F: 0 } }, femmeEnceinte: 0 } },
    mortalite: {},
  }, null);

  await saveManualReportMonth(env, '2025-02', {
    morbidite: { CARIES_TEMP: { parAge: { '0-11 mois': { M: 1, F: 0 } }, femmeEnceinte: 0 } },
    indicateursMorbidite: { CONSULTATIONS: { parAge: { '20-24 ans': { M: 2, F: 1 } }, femmeEnceinte: 0 } },
    therapeutique: {},
    mortalite: {},
  }, null);

  const q1 = await buildManualReport(env, 'quarter', '2025-Q1');
  check('T1 2025 : CARIES_TEMP M=3', q1.morbidite.find((r) => r.id === 'CARIES_TEMP').totaux.M === 3);
  check('T1 2025 : CARIES_TEMP F=1', q1.morbidite.find((r) => r.id === 'CARIES_TEMP').totaux.F === 1);
  check('T1 2025 : nbConsultations=11 (5+3+2+1)', q1.nbConsultations === 11);
  check('T1 2025 : 2 mois saisis sur 3', q1.periode.moisSaisis === 2 && q1.periode.mois.length === 3);

  const y2025 = await buildManualReport(env, 'year', '2025');
  check('Année 2025 : mêmes totaux (un seul trimestre saisi)', y2025.morbidite.find((r) => r.id === 'CARIES_TEMP').totaux.global === 4);
  check('Année 2025 : 12 mois dans la période', y2025.periode.mois.length === 12);

  // Ré-écriture d'un mois déjà saisi : remplace (PATCH), ne s'additionne pas.
  await saveManualReportMonth(env, '2025-01', {
    morbidite: { CARIES_TEMP: { parAge: { '0-11 mois': { M: 9, F: 9 } }, femmeEnceinte: 0 } },
  }, null);
  const monthReplaced = await buildManualReport(env, 'month', '2025-01');
  check('Ré-enregistrement du même mois remplace (ne cumule pas)', monthReplaced.morbidite.find((r) => r.id === 'CARIES_TEMP').totaux.M === 9);
  check('Une seule ligne stockée pour 2025-01 (upsert, pas de doublon)', store.odonto_manual_reports.filter((r) => r.periode === '2025-01').length === 1);

  // Ligne inconnue ignorée
  const saved = await saveManualReportMonth(env, '2025-03', { morbidite: { ID_INCONNU_XYZ: { parAge: {}, femmeEnceinte: 0 } } }, null);
  check('Ligne id inconnu ignorée (pas plantée)', saved.morbidite.every((r) => r.id !== 'ID_INCONNU_XYZ'));

  // Erreurs de période
  try {
    await buildManualReport(env, 'month', '2025/01');
    check('Période mois invalide rejetée', false);
  } catch (e) {
    check('Période mois invalide rejetée', /invalide/i.test(e.message));
  }

  const buf = buildManualReportWorkbook(q1, { nomStructure: 'Centre Test' });
  check('Export Excel rapport manuel produit un fichier non vide', buf.length > 1000);

  // --- Consommables ---------------------------------------------------------
  await saveManualConsumablesMonth(env, '2025-01', {
    EPI: { disponibilite: 'oui', joursRupture: 0 },
    FRAISES: { disponibilite: 'non', joursRupture: 5 },
  }, null);
  await saveManualConsumablesMonth(env, '2025-02', {
    EPI: { disponibilite: 'non', joursRupture: 3 },
    FRAISES: { disponibilite: 'oui', joursRupture: 0 },
  }, null);

  const consQ1 = await buildManualConsumables(env, 'quarter', '2025-Q1');
  const epi = consQ1.items.find((i) => i.id === 'EPI');
  check('EPI : total jours de rupture = 3', epi.joursRuptureTotal === 3);
  check('EPI : 1 mois disponible, 1 mois indisponible', epi.moisDisponible === 1 && epi.moisIndisponible === 1);
  check('19 consommables listés', consQ1.items.length === 19);

  const consBuf = buildConsommablesWorkbook(consQ1, { nomStructure: 'Centre Test' });
  check('Export Excel consommables produit un fichier non vide', consBuf.length > 500);

  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS SONT PASSÉS' : `${failures} ÉCHEC(S)`));
  process.exit(failures === 0 ? 0 : 1);
}

main();
