// Test de bout en bout du Worker ODONTO, exécuté directement sous Node.js
// (sans wrangler/Miniflare) en appelant default.fetch(request, env) comme le
// ferait le runtime Cloudflare. Utilise le vrai projet Supabase FAMMSIM,
// via la clé "anon" + des policies RLS temporaires ouvertes juste pour ce
// test (voir conversation : policies "odonto_temp_test", à supprimer après).
'use strict';

import worker from '../src/index.js';

const SUPABASE_URL = 'https://hglxyyqaouzjitaynfjq.supabase.co';
const SUPABASE_KEY = process.env.ODONTO_TEST_KEY;
if (!SUPABASE_KEY) {
  console.error('ECHEC: définir ODONTO_TEST_KEY (clé anon) dans l’environnement avant de lancer ce script.');
  process.exit(1);
}

const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY, ODONTO_NOM_STRUCTURE: 'Clinique Test' };

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(`http://worker.local${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, bytes: buf };
}

async function main() {
  const uniq = Date.now();

  // --- Authentification ---
  const loginFail = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'mauvais' } });
  check('login refusé avec un mauvais mot de passe', loginFail.status === 401);

  const login = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'KSbbFL9sqfso' } });
  check('login admin réussi', login.status === 200 && !!login.data.token);
  const adminToken = login.data.token;

  const me = await call('GET', '/api/auth/me', { token: adminToken });
  check('auth/me renvoie le bon rôle', me.status === 200 && me.data.user.role === 'admin');

  // --- Utilisateurs (admin) ---
  const newUsername = `praticien_test_${uniq}`;
  const createUser = await call('POST', '/api/users', {
    token: adminToken,
    body: { nom: 'Test', prenom: 'Praticien', username: newUsername, password: 'test1234', role: 'praticien' },
  });
  check('création d’un praticien', createUser.status === 201 && createUser.data.user.username === newUsername);
  check('mot de passe jamais renvoyé par l’API', !('password_hash' in createUser.data.user));

  const listUsers = await call('GET', '/api/users', { token: adminToken });
  check('liste des utilisateurs accessible (admin)', listUsers.status === 200 && Array.isArray(listUsers.data.users));

  const praticienLogin = await call('POST', '/api/auth/login', { body: { username: newUsername, password: 'test1234' } });
  check('login du praticien nouvellement créé', praticienLogin.status === 200);
  const praticienToken = praticienLogin.data.token;

  const forbidden = await call('GET', '/api/users', { token: praticienToken });
  check('un praticien ne peut pas lister les utilisateurs', forbidden.status === 403);

  // --- Référence (diagnostics/traitements + ajout personnalisé) ---
  const ref = await call('GET', '/api/reference', { token: adminToken });
  check('référence chargée (pathologies+traitements+indicateurs)', ref.status === 200 && ref.data.pathologies.length >= 24);

  const customLabel = `Diagnostic personnalisé ${uniq}`;
  const addPath = await call('POST', '/api/reference/pathologies', { token: adminToken, body: { libelle: customLabel } });
  check('ajout d’un diagnostic personnalisé', addPath.status === 201 && addPath.data.pathologie.libelle === customLabel);
  const customPathId = addPath.data.pathologie.id;

  const addPathAgain = await call('POST', '/api/reference/pathologies', { token: adminToken, body: { libelle: customLabel } });
  check('ajout du même libellé renvoie l’existant (dédoublonnage)', addPathAgain.data.pathologie.id === customPathId && addPathAgain.data.pathologie.existed === true);

  // --- Patients ---
  const createPatient = await call('POST', '/api/patients', {
    token: adminToken,
    body: { nom: 'Diallo', prenom: `Fatou${uniq}`, sexe: 'F', date_naissance: '1990-03-15', telephone: '771234567' },
  });
  check('création patient', createPatient.status === 201 && !!createPatient.data.patient.numero_dossier);
  const patientId = createPatient.data.patient.id;

  const getPatient = await call('GET', `/api/patients/${patientId}`, { token: adminToken });
  check('lecture patient + liste de consultations (vide)', getPatient.status === 200 && Array.isArray(getPatient.data.consultations));

  const searchPatient = await call('GET', `/api/patients?q=Diallo`, { token: adminToken });
  check('recherche patient par nom', searchPatient.status === 200 && searchPatient.data.patients.some((p) => p.id === patientId));

  // --- Consultation (diagnostics + traitements + paiement) ---
  const today = new Date().toISOString().slice(0, 10);
  const createConsult = await call('POST', `/api/patients/${patientId}/consultations`, {
    token: praticienToken,
    body: {
      date_consultation: today,
      type_cas: 'nouveau',
      motif: 'Douleur dentaire',
      diagnostics: ['CARIES_PERM', customPathId],
      traitements: ['EXTRACT_SIMPLE'],
      type_paiement: 'PAF',
      montant_prise_en_charge: 15000,
      montant_patient_paye: 2000,
      grossesse: true,
    },
  });
  check(
    'création consultation avec diagnostics/traitements/paiement',
    createConsult.status === 201 &&
      createConsult.data.consultation.diagnostics.includes('CARIES_PERM') &&
      createConsult.data.consultation.traitements.includes('EXTRACT_SIMPLE')
  );
  const consultId = createConsult.data.consultation.id;

  const getConsult = await call('GET', `/api/consultations/${consultId}`, { token: adminToken });
  check('lecture consultation isolée', getConsult.status === 200 && getConsult.data.consultation.id === consultId);

  const updateConsult = await call('PUT', `/api/consultations/${consultId}`, {
    token: adminToken,
    body: { diagnostics: ['CARIES_PERM'], traitements: ['EXTRACT_SIMPLE', 'DETARTRAGE'], montant_patient_paye: 3000 },
  });
  check(
    'mise à jour consultation (diagnostics réduits, traitement ajouté)',
    updateConsult.status === 200 &&
      !updateConsult.data.consultation.diagnostics.includes(customPathId) &&
      updateConsult.data.consultation.traitements.includes('DETARTRAGE') &&
      Number(updateConsult.data.consultation.montant_patient_paye) === 3000
  );

  const getPatientAfter = await call('GET', `/api/patients/${patientId}`, { token: adminToken });
  check(
    'la consultation apparaît dans le dossier patient',
    getPatientAfter.data.consultations.length === 1 && getPatientAfter.data.consultations[0].id === consultId
  );

  // --- Rapports ---
  const from = today;
  const to = today;
  const report = await call('GET', `/api/reports?from=${from}&to=${to}`, { token: adminToken });
  check('rapport d’activité généré', report.status === 200 && report.data.report.nbConsultations >= 1);
  const cariesRow = report.data.report && report.data.report.morbidite.find((r) => r.id === 'CARIES_PERM');
  check('le rapport compte bien le diagnostic CARIES_PERM', !!cariesRow && cariesRow.totaux.global >= 1);

  const exportXlsx = await call('GET', `/api/reports/export?from=${from}&to=${to}&structure=Clinique+Test`, { token: adminToken });
  const isZip = exportXlsx.bytes && exportXlsx.bytes[0] === 0x50 && exportXlsx.bytes[1] === 0x4b;
  check('export .xlsx du rapport d’activité (signature ZIP valide)', exportXlsx.status === 200 && isZip && exportXlsx.bytes.length > 1000);

  const finReport = await call('GET', `/api/reports/financial?from=${from}&to=${to}`, { token: adminToken });
  check('rapport financier généré', finReport.status === 200 && finReport.data.report.totalGeneral === 5000);

  const finExport = await call('GET', `/api/reports/financial/export?from=${from}&to=${to}`, { token: adminToken });
  const isZip2 = finExport.bytes && finExport.bytes[0] === 0x50 && finExport.bytes[1] === 0x4b;
  check('export .xlsx du rapport financier (signature ZIP valide)', finExport.status === 200 && isZip2);

  // --- Garde-fou dernier admin ---
  const demoteAdmin = await call('PUT', '/api/users/1', { token: adminToken, body: { role: 'praticien' } });
  check('impossible de rétrograder le seul admin actif', demoteAdmin.status === 400);

  // --- Déconnexion ---
  const logout = await call('POST', '/api/auth/logout', { token: adminToken });
  check('logout', logout.status === 200);
  const afterLogout = await call('GET', '/api/auth/me', { token: adminToken });
  check('le jeton est bien invalidé après logout', afterLogout.status === 401);

  console.log('\n' + (failures === 0 ? `TOUS LES TESTS SONT PASSÉS` : `${failures} ÉCHEC(S)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERREUR INATTENDUE:', err);
  process.exit(1);
});
