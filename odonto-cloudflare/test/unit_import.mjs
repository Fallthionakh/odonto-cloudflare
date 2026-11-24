// Test de la fonctionnalité d'import Excel (version Cloudflare Worker),
// SANS réseau : simule Supabase/PostgREST en mémoire (comme
// unit_reportbuilder.mjs), pour vérifier que l'import produit exactement le
// même comportement que la version Node.js. Utilise le même fichier
// d'exemple que odonto-app/test/test_import.js (test/registre_test.xlsx).
// Lancer avec : node test/unit_import.mjs
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Base PostgREST simulée en mémoire -----------------------------------
const store = {
  odonto_patients: [],
  odonto_consultations: [],
  odonto_consultation_diagnostics: [],
  odonto_consultation_traitements: [],
  odonto_custom_pathologies: [],
  odonto_custom_traitements: [],
};
const counters = { odonto_patients: 0, odonto_consultations: 0, odonto_consultation_diagnostics: 0, odonto_consultation_traitements: 0 };

function parseFilters(search) {
  const filters = [];
  for (const [key, val] of search.entries()) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    const m = /^eq\.(.*)$/.exec(val);
    if (m) filters.push({ field: key, value: m[1] });
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
      if (counters[table] !== undefined) {
        counters[table] += 1;
        copy.id = counters[table];
      }
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
  if (method === 'DELETE') {
    store[table] = store[table].filter((r) => !matchesFilters(r, parseFilters(u.searchParams)));
    return new Response('', { status: 200 });
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
  const { readXlsx } = await import('../src/utils/xlsx/xlsxReader.js');
  const { suggestMapping } = await import('../src/utils/importMapping.js');
  const { commitImport } = await import('../src/utils/importer.js');

  const buf = fs.readFileSync(path.join(__dirname, 'registre_test.xlsx'));
  const { headers, rows } = readXlsx(new Uint8Array(buf));
  check('14 colonnes lues (DEFLATE décodé correctement)', headers.length === 14);
  check('3 lignes de données lues', rows.length === 3);

  const suggestions = suggestMapping(headers);
  check('12 colonnes reconnues automatiquement, 2 non reconnues', suggestions.filter((s) => s.suggestion).length === 12);

  const mapping = {};
  for (const s of suggestions) mapping[String(s.index)] = s.suggestion || 'patient.extra';

  const report1 = await commitImport(env, { headers, rows, mapping }, 1);
  check('import 1 : 3 patients créés', report1.patients.created === 3);
  check('import 1 : 3 consultations créées', report1.consultations.created === 3);
  check('import 1 : "Carie exotique rarissime" créée en pathologie personnalisée', report1.customPathologiesCreated.length === 1);
  check('import 1 : "Gingivite chronique" reconnue comme K051 (pas de doublon)', store.odonto_custom_pathologies.length === 1);

  const report2 = await commitImport(env, { headers, rows, mapping }, 1);
  check('import 2 (même fichier) : dédoublonnage, 0 nouveau patient', report2.patients.created === 0 && report2.patients.matched === 3);
  check('import 2 : 3 nouvelles consultations (nouvelles visites)', report2.consultations.created === 3);
  check('total patients en base = 3', store.odonto_patients.length === 3);

  const diop = store.odonto_patients.find((p) => p.nom === 'Diop');
  check('donnée complémentaire conservée pour Diop', !!diop.donnees_complementaires && diop.donnees_complementaires.includes('Référé par: Dr Ndiaye'));

  const report3 = await commitImport(env, { headers: ['Nom', 'Prenom', 'Sexe'], rows: [['', 'Fatou', 'F']], mapping: { '0': 'patient.nom', '1': 'patient.prenom', '2': 'patient.sexe' } }, 1);
  check('ligne sans nom : signalée en erreur, pas de plantage', report3.rows[0].status === 'error');
  check('nombre de patients inchangé après la ligne invalide', store.odonto_patients.length === 3);

  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS IMPORT SONT PASSÉS' : `${failures} ÉCHEC(S)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERREUR INATTENDUE:', err);
  process.exit(1);
});
