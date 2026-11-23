import { apiFetch, ApiError, getToken, getStoredUser, setSession, clearSession } from './api.js';
import { AGE_GROUPS, computeAgeGroup, formatAge } from './ageGroups.js';

// ---------------------------------------------------------------------------
// État global
// ---------------------------------------------------------------------------
const state = {
  user: getStoredUser(),
  reference: null, // { pathologies, treatments, indicateurs, ageGroups }
};

const appEl = document.getElementById('app');
const topbarEl = document.getElementById('topbar');
const navEl = document.getElementById('nav');
const userLabelEl = document.getElementById('userLabel');
const toastEl = document.getElementById('toast');

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
  clearSession();
  state.user = null;
  location.hash = '#/login';
});

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = 'toast' + (isError ? ' error' : '');
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, 3800);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('fr-FR');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Conversion des sélecteurs de période rapides (semaine / mois / année) en
// bornes de dates (from/to), pour le rapport financier.
// ---------------------------------------------------------------------------
function isoDate(d) { return d.toISOString().slice(0, 10); }

function isoWeekInputValue(date) {
  // Convertit une date en valeur compatible <input type="week"> (AAAA-Www).
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weekInputToRange(value) {
  // value: "AAAA-Www" (norme ISO 8601, semaine du lundi au dimanche)
  const [yearStr, weekStr] = value.split('-W');
  const year = Number(yearStr);
  const week = Number(weekStr);
  if (!year || !week) return null;
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dayOfWeek = simple.getDay() || 7;
  const monday = new Date(simple);
  monday.setDate(simple.getDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: isoDate(monday), to: isoDate(sunday) };
}

function monthInputToRange(value) {
  // value: "AAAA-MM"
  const [y, m] = value.split('-').map(Number);
  if (!y || !m) return null;
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

function yearInputToRange(value) {
  const y = Number(value);
  if (!y) return null;
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

// ---------------------------------------------------------------------------
// Référence (listes de pathologies / traitements / indicateurs)
// ---------------------------------------------------------------------------
async function ensureReference() {
  if (state.reference) return state.reference;
  const data = await apiFetch('/api/reference');
  state.reference = data;
  return data;
}

function pathologieLabel(id) {
  const p = state.reference?.pathologies.find((x) => x.id === id);
  if (!p) return id;
  return p.libelle && p.libelle !== p.categorie ? `${p.categorie} — ${p.libelle}` : p.categorie;
}

function traitementLabel(id) {
  return state.reference?.treatments.find((x) => x.id === id)?.libelle || id;
}

function causeDecesLabel(id) {
  return state.reference?.indicateurs.mortalite.find((x) => x.id === id)?.libelle || id;
}

// ---------------------------------------------------------------------------
// Type de paiement de la consultation
// ---------------------------------------------------------------------------
const PAIEMENT_TYPES = {
  PAF: { libelle: 'PAF', labelPriseEnCharge: 'Montant de la prise en charge', labelPatient: 'Montant payé par le patient', showPriseEnCharge: true },
  LG: { libelle: 'LG (Lettre de garantie)', labelPriseEnCharge: 'Part employeur', labelPatient: 'Part patient', showPriseEnCharge: true },
  PERSONNEL: { libelle: 'Personnel', labelPriseEnCharge: 'Montant de la prise en charge', labelPatient: 'Montant payé par le patient', showPriseEnCharge: false },
  CAS_SOCIAL: { libelle: 'Cas social', labelPriseEnCharge: 'Montant social', labelPatient: 'Montant payé par le patient', showPriseEnCharge: true },
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return null;
  return Number(n).toLocaleString('fr-FR');
}

function paiementSummary(c) {
  const def = PAIEMENT_TYPES[c.type_paiement];
  if (!def) return c.type_paiement || '';
  const parts = [def.libelle];
  const priseEnCharge = fmtMontant(c.montant_prise_en_charge);
  const patientPaye = fmtMontant(c.montant_patient_paye);
  if (def.showPriseEnCharge && priseEnCharge !== null) parts.push(`${def.labelPriseEnCharge} : ${priseEnCharge}`);
  if (patientPaye !== null) parts.push(`${def.labelPatient} : ${patientPaye}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Mise en page / navigation
// ---------------------------------------------------------------------------
const NAV_ITEMS = [
  { hash: '#/patients', label: 'Patients', roles: ['admin', 'praticien'] },
  { hash: '#/reports', label: 'Rapport d’activité', roles: ['admin', 'praticien'] },
  { hash: '#/reports/financier', label: 'Rapport financier', roles: ['admin', 'praticien'] },
  { hash: '#/users', label: 'Utilisateurs', roles: ['admin'] },
  { hash: '#/import', label: 'Importer un fichier Excel', roles: ['admin'] },
];

function renderTopbar() {
  if (!state.user) {
    topbarEl.hidden = true;
    return;
  }
  topbarEl.hidden = false;
  const currentHash = location.hash || '#/patients';
  navEl.innerHTML = NAV_ITEMS.filter((i) => i.roles.includes(state.user.role))
    .map((i) => `<a href="${i.hash}" class="${currentHash.startsWith(i.hash) ? 'active' : ''}">${i.label}</a>`)
    .join('');
  userLabelEl.textContent = `${state.user.prenom} ${state.user.nom} · ${state.user.role === 'admin' ? 'Administrateur' : 'Praticien'}`;
}

function mount(html) {
  appEl.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Vue : connexion
// ---------------------------------------------------------------------------
function viewLogin() {
  mount(`
    <div class="login-wrap">
      <div class="login-title">
        <div class="logo">🦷</div>
        <h1>Odonto-Stomatologie</h1>
        <p class="muted">Registre des patients &amp; rapport d'activité</p>
      </div>
      <div class="card">
        <div id="loginError"></div>
        <form id="loginForm">
          <div class="field">
            <label>Identifiant</label>
            <input type="text" name="username" autocomplete="username" required />
          </div>
          <div class="field">
            <label>Mot de passe</label>
            <input type="password" name="password" autocomplete="current-password" required />
          </div>
          <button class="btn" type="submit" style="width:100%">Se connecter</button>
        </form>
      </div>
    </div>
  `);

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById('loginError');
    errBox.innerHTML = '';
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { username: fd.get('username'), password: fd.get('password') },
      });
      setSession(data.token, data.user);
      state.user = data.user;
      await ensureReference();
      renderTopbar();
      location.hash = '#/patients';
      route();
    } catch (err) {
      errBox.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    }
  });
}

// ---------------------------------------------------------------------------
// Vue : liste des patients
// ---------------------------------------------------------------------------
async function viewPatients() {
  mount(`
    <div class="card">
      <div class="btn-row" style="justify-content:space-between;">
        <h2 style="margin:0;">Patients</h2>
        <button class="btn" id="newPatientBtn">+ Nouveau patient</button>
      </div>
      <div class="field" style="margin-top:14px;max-width:360px;">
        <input type="text" id="searchInput" placeholder="Rechercher (nom, prénom, n° dossier, téléphone)…" />
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>N° dossier</th><th>Nom</th><th>Prénom</th><th>Âge</th><th>Sexe</th><th>Téléphone</th><th></th></tr></thead>
          <tbody id="patientsBody"><tr><td colspan="7" class="muted">Chargement…</td></tr></tbody>
        </table>
      </div>
    </div>
  `);

  document.getElementById('newPatientBtn').addEventListener('click', () => { location.hash = '#/patients/new'; });

  const searchInput = document.getElementById('searchInput');
  let debounceT;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceT);
    debounceT = setTimeout(() => loadPatients(searchInput.value.trim()), 250);
  });

  async function loadPatients(q) {
    const tbody = document.getElementById('patientsBody');
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const data = await apiFetch(`/api/patients?${params.toString()}`);
      if (!data.patients.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Aucun patient trouvé.</td></tr>`;
        return;
      }
      tbody.innerHTML = data.patients.map((p) => `
        <tr class="row-link" data-id="${p.id}" style="cursor:pointer;">
          <td>${escapeHtml(p.numero_dossier || '—')}</td>
          <td>${escapeHtml(p.nom)}</td>
          <td>${escapeHtml(p.prenom)}</td>
          <td>${escapeHtml(formatAge(p.date_naissance))}</td>
          <td>${p.sexe}</td>
          <td>${escapeHtml(p.telephone || '—')}</td>
          <td><button class="btn btn-secondary btn-sm" data-id="${p.id}">Ouvrir</button></td>
        </tr>
      `).join('');
      tbody.querySelectorAll('[data-id]').forEach((elx) => {
        elx.addEventListener('click', () => { location.hash = `#/patients/${elx.dataset.id}`; });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="error-box">${escapeHtml(err.message)}</div></td></tr>`;
    }
  }

  loadPatients('');
}

function patientFormFields(p = {}) {
  return `
    <div class="grid grid-2">
      <div class="field"><label>Nom *</label><input type="text" name="nom" value="${escapeHtml(p.nom || '')}" required /></div>
      <div class="field"><label>Prénom *</label><input type="text" name="prenom" value="${escapeHtml(p.prenom || '')}" required /></div>
      <div class="field"><label>Date de naissance</label><input type="date" name="date_naissance" value="${p.date_naissance || ''}" /></div>
      <div class="field">
        <label>Sexe *</label>
        <select name="sexe" required>
          <option value="M" ${p.sexe === 'M' ? 'selected' : ''}>Masculin</option>
          <option value="F" ${p.sexe === 'F' ? 'selected' : ''}>Féminin</option>
        </select>
      </div>
      <div class="field"><label>Téléphone</label><input type="tel" name="telephone" value="${escapeHtml(p.telephone || '')}" /></div>
      <div class="field"><label>Adresse</label><input type="text" name="adresse" value="${escapeHtml(p.adresse || '')}" /></div>
      <div class="field"><label>Personne à contacter</label><input type="text" name="contact_nom" value="${escapeHtml(p.contact_nom || '')}" /></div>
      <div class="field"><label>Téléphone du contact</label><input type="tel" name="contact_telephone" value="${escapeHtml(p.contact_telephone || '')}" /></div>
    </div>
  `;
}

function readPatientForm(form) {
  const fd = new FormData(form);
  return {
    nom: fd.get('nom')?.trim(),
    prenom: fd.get('prenom')?.trim(),
    date_naissance: fd.get('date_naissance') || null,
    sexe: fd.get('sexe'),
    telephone: fd.get('telephone')?.trim() || null,
    adresse: fd.get('adresse')?.trim() || null,
    contact_nom: fd.get('contact_nom')?.trim() || null,
    contact_telephone: fd.get('contact_telephone')?.trim() || null,
  };
}

async function viewPatientNew() {
  mount(`
    <div class="card" style="max-width:720px;">
      <h2>Nouveau patient</h2>
      <div id="formError"></div>
      <form id="patientForm">
        ${patientFormFields()}
        <div class="btn-row">
          <button class="btn" type="submit">Enregistrer</button>
          <button class="btn btn-secondary" type="button" id="cancelBtn">Annuler</button>
        </div>
      </form>
    </div>
  `);
  document.getElementById('cancelBtn').addEventListener('click', () => history.back());
  document.getElementById('patientForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await apiFetch('/api/patients', { method: 'POST', body: readPatientForm(e.target) });
      toast('Patient enregistré');
      location.hash = `#/patients/${data.patient.id}`;
    } catch (err) {
      document.getElementById('formError').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    }
  });
}

// ---------------------------------------------------------------------------
// Vue : détail patient + historique consultations
// ---------------------------------------------------------------------------
const STATUT_LABELS = {
  aucun: '', refere: 'Référé', contre_refere: 'Contre-référé', vu_par_reference: 'Vu par référence',
};
function statutBadge(c) {
  const label = STATUT_LABELS[c.statut_reference];
  if (!label) return '';
  return `<span class="badge badge-blue">${label}</span>`;
}

// --- Résumé imprimable / téléchargeable d'une consultation ------------------
function slugFileName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'consultation';
}

function consultationSummaryText(patient, c) {
  const lines = [];
  lines.push(`Consultation du ${fmtDate(c.date_consultation)}`);
  lines.push(`Patient : ${patient.nom} ${patient.prenom} — ${formatAge(patient.date_naissance)} — ${patient.sexe === 'F' ? 'Féminin' : 'Masculin'}`);
  if (patient.numero_dossier) lines.push(`Dossier : ${patient.numero_dossier}`);
  lines.push(`Type de cas : ${c.type_cas === 'nouveau' ? 'Nouveau cas' : 'Ancien cas'}`);
  if (STATUT_LABELS[c.statut_reference]) lines.push(`Statut de référence : ${STATUT_LABELS[c.statut_reference]}`);
  if (c.grossesse) lines.push('Femme enceinte : oui');
  if (c.motif) lines.push(`Motif de consultation : ${c.motif}`);
  if (c.antecedents) lines.push(`Antécédents : ${c.antecedents}`);
  if (c.examen_clinique) lines.push(`Examen clinique : ${c.examen_clinique}`);
  if (c.diagnostics?.length) lines.push(`Diagnostic(s) : ${c.diagnostics.map(pathologieLabel).join(', ')}`);
  if (c.traitements?.length) lines.push(`Traitement(s) : ${c.traitements.map(traitementLabel).join(', ')}`);
  if (c.cat_observation) lines.push(`CAT / Observation : ${c.cat_observation}`);
  if (c.type_paiement) lines.push(`Paiement : ${paiementSummary(c)}`);
  if (c.issue === 'decede') lines.push(`Issue : Décédé — ${causeDecesLabel(c.cause_deces_id)}`);
  if (c.rendez_vous_suivi) lines.push(`Rendez-vous de suivi : ${fmtDate(c.rendez_vous_suivi)}`);
  return lines.join('\n');
}

function printConsultation(patient, c) {
  const text = consultationSummaryText(patient, c);
  const win = window.open('', '_blank', 'width=640,height=720');
  if (!win) { toast("Impossible d'ouvrir la fenêtre d'impression (bloqueur de popup ?)", true); return; }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
    <title>Consultation — ${escapeHtml(patient.nom)} ${escapeHtml(patient.prenom)}</title>
    <style>
      body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 28px; color: #1f2937; }
      h1 { font-size: 15px; margin: 0 0 4px; }
      .sub { color: #6b7280; font-size: 12px; margin-bottom: 18px; }
      pre { white-space: pre-wrap; font-family: inherit; font-size: 13.5px; line-height: 1.7; }
    </style>
  </head><body>
    <h1>🦷 Service d'Odonto-Stomatologie</h1>
    <div class="sub">Fiche de consultation</div>
    <pre>${escapeHtml(text)}</pre>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function downloadConsultationSummary(patient, c) {
  const text = consultationSummaryText(patient, c);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `consultation_${c.date_consultation}_${slugFileName(patient.nom + '_' + patient.prenom)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Résumé téléchargé');
}

async function viewPatientDetail(id) {
  mount(`<div class="card muted">Chargement…</div>`);
  try {
    const { patient, consultations } = await apiFetch(`/api/patients/${id}`);
    mount(`
      <div class="card">
        <div class="btn-row" style="justify-content:space-between;">
          <div>
            <h2 style="margin:0 0 4px;">${escapeHtml(patient.nom)} ${escapeHtml(patient.prenom)}</h2>
            <div class="muted">Dossier ${escapeHtml(patient.numero_dossier || '—')} · ${formatAge(patient.date_naissance)} · ${patient.sexe === 'F' ? 'Féminin' : 'Masculin'}</div>
          </div>
          <div class="btn-row">
            <button class="btn btn-secondary btn-sm" id="editPatientBtn">Modifier la fiche</button>
            <button class="btn btn-sm" id="newConsultBtn">+ Nouvelle consultation</button>
          </div>
        </div>
        <div id="patientEditZone"></div>
        <div class="grid grid-3" style="margin-top:14px;font-size:13px;">
          <div><label>Téléphone</label>${escapeHtml(patient.telephone || '—')}</div>
          <div><label>Adresse</label>${escapeHtml(patient.adresse || '—')}</div>
          <div><label>Contact</label>${escapeHtml(patient.contact_nom || '—')} ${patient.contact_telephone ? `(${escapeHtml(patient.contact_telephone)})` : ''}</div>
        </div>
      </div>

      <div class="section-title">Historique des consultations (${consultations.length})</div>
      <div id="consultList">${consultations.length ? '' : '<div class="card empty-state">Aucune consultation enregistrée pour ce patient.</div>'}</div>
    `);

    document.getElementById('newConsultBtn').addEventListener('click', () => {
      location.hash = `#/patients/${id}/consultations/new`;
    });

    document.getElementById('editPatientBtn').addEventListener('click', () => {
      const zone = document.getElementById('patientEditZone');
      if (zone.innerHTML) { zone.innerHTML = ''; return; }
      zone.innerHTML = `
        <form id="editPatientForm" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px;">
          ${patientFormFields(patient)}
          <div class="btn-row"><button class="btn" type="submit">Enregistrer les modifications</button></div>
        </form>
      `;
      document.getElementById('editPatientForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await apiFetch(`/api/patients/${id}`, { method: 'PUT', body: readPatientForm(e.target) });
          toast('Fiche patient mise à jour');
          viewPatientDetail(id);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    if (consultations.length) {
      const listEl = document.getElementById('consultList');
      listEl.innerHTML = consultations.map((c, idx) => `
        <div class="consult-card" data-idx="${idx}">
          <div class="consult-head" aria-expanded="${idx === 0 ? 'true' : 'false'}">
            <span class="chevron" data-chevron>${idx === 0 ? '−' : '+'}</span>
            <div class="consult-summary">
              <strong>${fmtDate(c.date_consultation)}</strong>
              <span class="badge ${c.type_cas === 'nouveau' ? 'badge-green' : 'badge-gray'}">${c.type_cas === 'nouveau' ? 'Nouveau cas' : 'Ancien cas'}</span>
              ${statutBadge(c)}
              ${c.grossesse ? '<span class="badge badge-warn">Femme enceinte</span>' : ''}
              ${c.issue === 'decede' ? `<span class="badge badge-red">Décès — ${escapeHtml(causeDecesLabel(c.cause_deces_id))}</span>` : ''}
            </div>
            <div class="consult-actions">
              <button type="button" class="icon-btn" data-print title="Imprimer cette consultation" aria-label="Imprimer">🖨️</button>
              <button type="button" class="icon-btn" data-save title="Télécharger un résumé" aria-label="Enregistrer">💾</button>
              <button type="button" class="icon-btn" data-edit="${c.id}" title="Modifier" aria-label="Modifier">✏️</button>
            </div>
          </div>
          <div class="consult-body" ${idx === 0 ? '' : 'hidden'}>
            ${c.motif ? `<p><strong>Motif :</strong> ${escapeHtml(c.motif)}</p>` : ''}
            ${c.antecedents ? `<p><strong>Antécédents :</strong> ${escapeHtml(c.antecedents)}</p>` : ''}
            ${c.examen_clinique ? `<p><strong>Examen clinique :</strong> ${escapeHtml(c.examen_clinique)}</p>` : ''}
            ${c.diagnostics.length ? `<p><strong>Diagnostic(s) :</strong> ${c.diagnostics.map((d) => escapeHtml(pathologieLabel(d))).join(' · ')}</p>` : ''}
            ${c.traitements.length ? `<p><strong>Traitement(s) :</strong> ${c.traitements.map((t) => escapeHtml(traitementLabel(t))).join(' · ')}</p>` : ''}
            ${c.cat_observation ? `<p><strong>CAT / Observation :</strong> ${escapeHtml(c.cat_observation)}</p>` : ''}
            ${c.type_paiement ? `<p><strong>Paiement :</strong> ${escapeHtml(paiementSummary(c))}</p>` : ''}
            ${c.rendez_vous_suivi ? `<p class="muted">Rendez-vous de suivi : ${fmtDate(c.rendez_vous_suivi)}</p>` : ''}
            ${!c.motif && !c.antecedents && !c.examen_clinique && !c.diagnostics.length && !c.traitements.length && !c.cat_observation && !c.type_paiement && !c.rendez_vous_suivi ? '<p class="muted">Aucun détail supplémentaire renseigné.</p>' : ''}
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('.consult-head').forEach((head) => {
        head.addEventListener('click', (e) => {
          if (e.target.closest('.consult-actions')) return;
          const body = head.closest('.consult-card').querySelector('.consult-body');
          const chevron = head.querySelector('[data-chevron]');
          const expanded = !body.hidden;
          body.hidden = expanded;
          chevron.textContent = expanded ? '+' : '−';
          head.setAttribute('aria-expanded', String(!expanded));
        });
      });
      listEl.querySelectorAll('[data-print]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.closest('.consult-card').dataset.idx);
          printConsultation(patient, consultations[idx]);
        });
      });
      listEl.querySelectorAll('[data-save]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.closest('.consult-card').dataset.idx);
          downloadConsultationSummary(patient, consultations[idx]);
        });
      });
      listEl.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => { location.hash = `#/patients/${id}/consultations/${btn.dataset.edit}`; });
      });
    }
  } catch (err) {
    mount(`<div class="error-box">${escapeHtml(err.message)}</div>`);
  }
}

// ---------------------------------------------------------------------------
// Vue : formulaire de consultation (création / édition)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Liste déroulante multi-sélection avec recherche et ajout à la volée
// (utilisée pour les diagnostics et les traitements de la consultation).
// ---------------------------------------------------------------------------
function normalizeSearch(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function comboboxHtml(id, placeholder) {
  return `
    <div class="combo" id="${id}">
      <div class="combo-chips" data-chips></div>
      <div class="combo-input-wrap">
        <input type="text" data-input placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
        <div class="combo-panel" data-panel hidden></div>
      </div>
    </div>
  `;
}

// items : tableau d'objets {id, libelle, categorie?} — passé par référence
// (les ajouts via onAddNew sont poussés dedans, ce qui met aussi à jour
// l'état de référence partagé si ce même tableau provient de ensureReference()).
function wireCombobox({ root, items, selectedIds, groupBy, itemLabel, chipLabel, onAddNew }) {
  const chipsEl = root.querySelector('[data-chips]');
  const inputEl = root.querySelector('[data-input]');
  const panelEl = root.querySelector('[data-panel]');
  let selected = [...selectedIds];

  function renderChips() {
    chipsEl.innerHTML = selected.map((id) => {
      const item = items.find((i) => i.id === id);
      const text = item ? chipLabel(item) : id;
      return `<span class="combo-chip" data-id="${escapeHtml(id)}">${escapeHtml(text)}<button type="button" data-remove="${escapeHtml(id)}" aria-label="Retirer">×</button></span>`;
    }).join('');
    chipsEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected = selected.filter((id) => id !== btn.dataset.remove);
        renderChips();
        renderPanel(inputEl.value);
      });
    });
  }

  function optionHtml(item) {
    const isSel = selected.includes(item.id);
    return `<div class="combo-option${isSel ? ' selected' : ''}" data-option="${escapeHtml(item.id)}"><span class="check">${isSel ? '✓' : ''}</span>${escapeHtml(itemLabel(item))}</div>`;
  }

  function renderPanel(query) {
    const q = normalizeSearch(query);
    const matches = items.filter((item) => {
      const hay = normalizeSearch(`${item.categorie || ''} ${item.libelle || ''}`);
      return !q || hay.includes(q);
    });
    let html = '';
    if (groupBy) {
      let lastGroup = null;
      for (const item of matches) {
        const g = groupBy(item);
        if (g !== lastGroup) { html += `<div class="combo-group">${escapeHtml(g)}</div>`; lastGroup = g; }
        html += optionHtml(item);
      }
    } else {
      html = matches.map(optionHtml).join('');
    }
    if (!matches.length) html += `<div class="combo-empty">Aucun résultat</div>`;
    const trimmed = query.trim();
    const exact = trimmed && items.some((i) => normalizeSearch(itemLabel(i)) === normalizeSearch(trimmed));
    if (onAddNew && trimmed && !exact) {
      html += `<div class="combo-add" data-add>+ Ajouter « ${escapeHtml(trimmed)} »</div>`;
    }
    panelEl.innerHTML = html;
    panelEl.hidden = false;

    panelEl.querySelectorAll('[data-option]').forEach((el) => {
      el.addEventListener('click', () => toggle(el.dataset.option));
    });
    const addEl = panelEl.querySelector('[data-add]');
    if (addEl) {
      addEl.addEventListener('click', async () => {
        const text = inputEl.value.trim();
        if (!text) return;
        addEl.textContent = 'Ajout…';
        try {
          const newItem = await onAddNew(text);
          items.push(newItem);
          selected.push(newItem.id);
          inputEl.value = '';
          renderChips();
          renderPanel('');
          inputEl.focus();
        } catch (err) {
          toast(err.message, true);
          renderPanel(inputEl.value);
        }
      });
    }
  }

  function toggle(id) {
    if (selected.includes(id)) selected = selected.filter((x) => x !== id);
    else selected.push(id);
    renderChips();
    renderPanel(inputEl.value);
    inputEl.focus();
  }

  panelEl.addEventListener('mousedown', (e) => e.preventDefault());
  inputEl.addEventListener('focus', () => renderPanel(inputEl.value));
  inputEl.addEventListener('input', () => renderPanel(inputEl.value));
  inputEl.addEventListener('blur', () => { panelEl.hidden = true; });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { panelEl.hidden = true; inputEl.blur(); }
    if (e.key === 'Enter') e.preventDefault();
  });

  renderChips();

  return { getSelectedIds: () => selected };
}

async function viewConsultationForm(patientId, consultationId) {
  mount(`<div class="card muted">Chargement…</div>`);
  try {
    const [{ patient, consultations: existingConsultations }, ref] = await Promise.all([
      apiFetch(`/api/patients/${patientId}`),
      ensureReference(),
    ]);
    let consultation = null;
    if (consultationId) {
      const data = await apiFetch(`/api/consultations/${consultationId}`);
      consultation = data.consultation;
    }
    // Si le patient a déjà au moins une consultation, celle-ci est
    // automatiquement considérée comme « Ancien cas » (reste modifiable
    // via le bouton Nouveau cas / Ancien cas juste en dessous).
    const c = consultation || {
      date_consultation: todayIso(), type_cas: existingConsultations.length > 0 ? 'ancien' : 'nouveau', statut_reference: 'aucun',
      motif: '', antecedents: '', examen_clinique: '', cat_observation: '',
      grossesse: 0, issue: 'vivant', cause_deces_id: '', rendez_vous_suivi: '',
      type_paiement: '', montant_prise_en_charge: '', montant_patient_paye: '',
      diagnostics: [], traitements: [],
    };

    mount(`
      <div class="card" style="max-width:920px;">
        <h2>${consultation ? 'Modifier la' : 'Nouvelle'} consultation — ${escapeHtml(patient.nom)} ${escapeHtml(patient.prenom)}</h2>
        <div id="formError"></div>
        <form id="consultForm">
          <div class="grid grid-3">
            <div class="field"><label>Date de consultation *</label><input type="date" name="date_consultation" value="${c.date_consultation}" required /></div>
            <div class="field">
              <label>Type de cas</label>
              <div class="pill-toggle" data-field="type_cas">
                <button type="button" data-value="nouveau" class="${c.type_cas === 'nouveau' ? 'active' : ''}">Nouveau cas</button>
                <button type="button" data-value="ancien" class="${c.type_cas === 'ancien' ? 'active' : ''}">Ancien cas</button>
              </div>
            </div>
            <div class="field">
              <label>Statut de référence</label>
              <select name="statut_reference">
                <option value="aucun" ${c.statut_reference === 'aucun' ? 'selected' : ''}>Aucun</option>
                <option value="refere" ${c.statut_reference === 'refere' ? 'selected' : ''}>Référé</option>
                <option value="contre_refere" ${c.statut_reference === 'contre_refere' ? 'selected' : ''}>Contre-référé</option>
                <option value="vu_par_reference" ${c.statut_reference === 'vu_par_reference' ? 'selected' : ''}>Vu par référence</option>
              </select>
            </div>
          </div>

          <div class="field"><label>Motif de consultation</label><textarea name="motif">${escapeHtml(c.motif || '')}</textarea></div>
          <div class="field"><label>Antécédents</label><textarea name="antecedents">${escapeHtml(c.antecedents || '')}</textarea></div>
          <div class="field"><label>Examen clinique</label><textarea name="examen_clinique">${escapeHtml(c.examen_clinique || '')}</textarea></div>

          <div class="field">
            <label>Diagnostic(s)</label>
            ${comboboxHtml('diagCombo', 'Rechercher un diagnostic…')}
          </div>

          <div class="field">
            <label>Traitement(s) effectué(s)</label>
            ${comboboxHtml('traitCombo', 'Rechercher un traitement…')}
          </div>

          <div class="field"><label>CAT / Observation</label><textarea name="cat_observation">${escapeHtml(c.cat_observation || '')}</textarea></div>

          <div class="grid grid-3">
            <div class="field">
              <label>Type de paiement</label>
              <select name="type_paiement" id="typePaiementSelect">
                <option value="" ${!c.type_paiement ? 'selected' : ''}>Non renseigné</option>
                ${Object.entries(PAIEMENT_TYPES).map(([id, def]) => `<option value="${id}" ${c.type_paiement === id ? 'selected' : ''}>${escapeHtml(def.libelle)}</option>`).join('')}
              </select>
            </div>
            <div class="field" id="montantPriseEnChargeField" hidden>
              <label id="labelPriseEnCharge">Montant de la prise en charge</label>
              <input type="number" min="0" step="1" name="montant_prise_en_charge" value="${c.montant_prise_en_charge ?? ''}" />
            </div>
            <div class="field" id="montantPatientField" hidden>
              <label id="labelPatientPaye">Montant payé par le patient</label>
              <input type="number" min="0" step="1" name="montant_patient_paye" value="${c.montant_patient_paye ?? ''}" />
            </div>
          </div>

          <div class="grid grid-3">
            ${patient.sexe === 'F' ? `
            <div class="field">
              <label>Femme enceinte</label>
              <label style="font-weight:400;"><input type="checkbox" name="grossesse" style="width:auto;" ${c.grossesse ? 'checked' : ''}/> Oui</label>
            </div>` : ''}
            <div class="field">
              <label>Issue</label>
              <div class="pill-toggle" data-field="issue">
                <button type="button" data-value="vivant" class="${c.issue === 'vivant' ? 'active' : ''}">Vivant</button>
                <button type="button" data-value="decede" class="${c.issue === 'decede' ? 'active' : ''}">Décédé</button>
              </div>
            </div>
            <div class="field" id="causeDecesField" ${c.issue === 'decede' ? '' : 'hidden'}>
              <label>Cause du décès</label>
              <select name="cause_deces_id">
                ${ref.indicateurs.mortalite.map((m) => `<option value="${m.id}" ${c.cause_deces_id === m.id ? 'selected' : ''}>${escapeHtml(m.libelle)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Rendez-vous de suivi</label><input type="date" name="rendez_vous_suivi" value="${c.rendez_vous_suivi || ''}" /></div>
          </div>

          <input type="hidden" name="type_cas" value="${c.type_cas}" />
          <input type="hidden" name="issue" value="${c.issue}" />

          <div class="btn-row">
            <button class="btn" type="submit">Enregistrer la consultation</button>
            <button class="btn btn-secondary" type="button" id="cancelBtn">Annuler</button>
          </div>
        </form>
      </div>
    `);

    document.getElementById('cancelBtn').addEventListener('click', () => { location.hash = `#/patients/${patientId}`; });

    const diagCombo = wireCombobox({
      root: document.getElementById('diagCombo'),
      items: ref.pathologies,
      selectedIds: c.diagnostics,
      groupBy: (p) => p.categorie,
      itemLabel: (p) => (p.libelle && p.libelle !== p.categorie ? p.libelle : p.categorie),
      chipLabel: (p) => (p.libelle && p.libelle !== p.categorie ? `${p.categorie} — ${p.libelle}` : p.categorie),
      onAddNew: async (text) => {
        const { pathologie } = await apiFetch('/api/reference/pathologies', { method: 'POST', body: { libelle: text } });
        return pathologie;
      },
    });
    const traitCombo = wireCombobox({
      root: document.getElementById('traitCombo'),
      items: ref.treatments,
      selectedIds: c.traitements,
      itemLabel: (t) => t.libelle,
      chipLabel: (t) => t.libelle,
      onAddNew: async (text) => {
        const { traitement } = await apiFetch('/api/reference/traitements', { method: 'POST', body: { libelle: text } });
        return traitement;
      },
    });

    function applyPaiementType(typeId) {
      const def = PAIEMENT_TYPES[typeId];
      const priseEnChargeField = document.getElementById('montantPriseEnChargeField');
      const patientField = document.getElementById('montantPatientField');
      if (!def) {
        priseEnChargeField.hidden = true;
        patientField.hidden = true;
        return;
      }
      document.getElementById('labelPriseEnCharge').textContent = def.labelPriseEnCharge;
      document.getElementById('labelPatientPaye').textContent = def.labelPatient;
      priseEnChargeField.hidden = !def.showPriseEnCharge;
      if (!def.showPriseEnCharge) priseEnChargeField.querySelector('input').value = '';
      patientField.hidden = false;
    }
    applyPaiementType(c.type_paiement);
    document.getElementById('typePaiementSelect').addEventListener('change', (e) => applyPaiementType(e.target.value));

    document.querySelectorAll('.pill-toggle').forEach((toggle) => {
      const field = toggle.dataset.field;
      const hiddenInput = document.querySelector(`input[name="${field}"]`);
      toggle.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          toggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          hiddenInput.value = btn.dataset.value;
          if (field === 'issue') {
            document.getElementById('causeDecesField').hidden = btn.dataset.value !== 'decede';
          }
        });
      });
    });

    document.getElementById('consultForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        date_consultation: fd.get('date_consultation'),
        type_cas: fd.get('type_cas'),
        statut_reference: fd.get('statut_reference'),
        motif: fd.get('motif')?.trim() || null,
        antecedents: fd.get('antecedents')?.trim() || null,
        examen_clinique: fd.get('examen_clinique')?.trim() || null,
        cat_observation: fd.get('cat_observation')?.trim() || null,
        type_paiement: fd.get('type_paiement') || null,
        montant_prise_en_charge: fd.get('montant_prise_en_charge') || null,
        montant_patient_paye: fd.get('montant_patient_paye') || null,
        grossesse: fd.get('grossesse') === 'on',
        issue: fd.get('issue'),
        cause_deces_id: fd.get('cause_deces_id') || null,
        rendez_vous_suivi: fd.get('rendez_vous_suivi') || null,
        diagnostics: diagCombo.getSelectedIds(),
        traitements: traitCombo.getSelectedIds(),
      };
      try {
        if (consultation) {
          await apiFetch(`/api/consultations/${consultation.id}`, { method: 'PUT', body });
          toast('Consultation mise à jour');
        } else {
          await apiFetch(`/api/patients/${patientId}/consultations`, { method: 'POST', body });
          toast('Consultation enregistrée');
        }
        location.hash = `#/patients/${patientId}`;
      } catch (err) {
        document.getElementById('formError').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
      }
    });
  } catch (err) {
    mount(`<div class="error-box">${escapeHtml(err.message)}</div>`);
  }
}

// ---------------------------------------------------------------------------
// Vue : rapport d'activité
// ---------------------------------------------------------------------------
function reportSectionTable(title, rows) {
  const ageCols = AGE_GROUPS.map((ag) => `<th colspan="2">${ag}</th>`).join('');
  const subCols = AGE_GROUPS.map(() => '<th>M</th><th>F</th>').join('');
  const body = rows.map((r) => {
    const cells = AGE_GROUPS.map((ag) => {
      const v = r.parAge[ag] || { M: 0, F: 0 };
      return `<td>${v.M}</td><td>${v.F}</td>`;
    }).join('');
    return `<tr><td>${escapeHtml(r.libelle)}</td>${cells}<td><strong>${r.totaux.M}</strong></td><td><strong>${r.totaux.F}</strong></td><td>${r.femmeEnceinte}</td></tr>`;
  }).join('');
  return `
    <div class="section-title">${title}</div>
    <div class="table-wrap">
      <table class="report-table">
        <thead>
          <tr><th rowspan="2">Libellé</th>${ageCols}<th colspan="2">Total</th><th rowspan="2">Femme enceinte</th></tr>
          <tr>${subCols}<th>M</th><th>F</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

async function viewReports() {
  const { from, to } = monthRange();
  mount(`
    <div class="card">
      <h2 style="margin-top:0;">Rapport d'activité médical et sanitaire</h2>
      <div class="btn-row" style="align-items:flex-end;">
        <div class="field" style="max-width:180px;"><label>Du</label><input type="date" id="fromInput" value="${from}" /></div>
        <div class="field" style="max-width:180px;"><label>Au</label><input type="date" id="toInput" value="${to}" /></div>
        <button class="btn" id="generateBtn">Générer le rapport</button>
        <button class="btn btn-secondary" id="exportBtn">Télécharger en Excel</button>
      </div>
      <div id="reportSummary"></div>
    </div>
    <div id="reportBody"></div>
  `);

  async function generate() {
    const from = document.getElementById('fromInput').value;
    const to = document.getElementById('toInput').value;
    if (!from || !to) return toast('Veuillez choisir une période', true);
    const summary = document.getElementById('reportSummary');
    const body = document.getElementById('reportBody');
    summary.innerHTML = '<p class="muted">Génération du rapport…</p>';
    body.innerHTML = '';
    try {
      const { report } = await apiFetch(`/api/reports?from=${from}&to=${to}`);
      summary.innerHTML = `<div class="info-box">${report.nbConsultations} consultation(s) enregistrée(s) du ${fmtDate(report.periode.from)} au ${fmtDate(report.periode.to)}.</div>`;
      body.innerHTML = [
        reportSectionTable('Synthèse de Morbidité', report.morbidite),
        reportSectionTable('Rapport de morbidité du cabinet dentaire', report.indicateursMorbidite),
        reportSectionTable('Rapport thérapeutique', report.therapeutique),
        reportSectionTable('Rapport de Mortalité', report.mortalite),
      ].join('');
    } catch (err) {
      summary.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById('generateBtn').addEventListener('click', generate);
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const from = document.getElementById('fromInput').value;
    const to = document.getElementById('toInput').value;
    if (!from || !to) return toast('Veuillez choisir une période', true);
    try {
      const blob = await apiFetch(`/api/reports/export?from=${from}&to=${to}`, { isBlob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport_odonto_${from}_au_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, true);
    }
  });

  generate();
}

// ---------------------------------------------------------------------------
// Vue : rapport financier
// ---------------------------------------------------------------------------
function financialPeriodControls() {
  const now = new Date();
  return `
    <div class="field">
      <label>Période</label>
      <div class="pill-toggle" data-field="periode_type">
        <button type="button" data-value="semaine">Semaine</button>
        <button type="button" data-value="mois" class="active">Mois</button>
        <button type="button" data-value="annee">Année</button>
        <button type="button" data-value="intervalle">Intervalle</button>
      </div>
    </div>
    <div class="grid grid-3" id="periodeInputs">
      <div class="field" data-periode="semaine" hidden><label>Semaine</label><input type="week" id="weekInput" value="${isoWeekInputValue(now)}" /></div>
      <div class="field" data-periode="mois"><label>Mois</label><input type="month" id="monthInput" value="${now.toISOString().slice(0, 7)}" /></div>
      <div class="field" data-periode="annee" hidden><label>Année</label><input type="number" id="yearInput" min="2000" max="2100" value="${now.getFullYear()}" /></div>
      <div class="field" data-periode="intervalle" hidden><label>Du</label><input type="date" id="intervalFromInput" value="${monthRange().from}" /></div>
      <div class="field" data-periode="intervalle" hidden><label>Au</label><input type="date" id="intervalToInput" value="${monthRange().to}" /></div>
    </div>
  `;
}

function wirePeriodControls(container, onChange) {
  let periodeType = 'mois';
  const toggle = container.querySelector('[data-field="periode_type"]');
  function showFieldsFor(type) {
    container.querySelectorAll('[data-periode]').forEach((el) => { el.hidden = el.dataset.periode !== type; });
  }
  toggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      periodeType = btn.dataset.value;
      showFieldsFor(periodeType);
      onChange && onChange();
    });
  });
  showFieldsFor(periodeType);

  return function resolvePeriod() {
    if (periodeType === 'semaine') return weekInputToRange(container.querySelector('#weekInput').value);
    if (periodeType === 'mois') return monthInputToRange(container.querySelector('#monthInput').value);
    if (periodeType === 'annee') return yearInputToRange(container.querySelector('#yearInput').value);
    const from = container.querySelector('#intervalFromInput').value;
    const to = container.querySelector('#intervalToInput').value;
    return from && to ? { from, to } : null;
  };
}

function financialTypeRow(row) {
  const note = row.labelPriseEnCharge
    ? `<div class="muted" style="font-size:11px;">${escapeHtml(row.labelPriseEnCharge)}</div>`
    : `<div class="muted" style="font-size:11px;">Entièrement à la charge du patient</div>`;
  return `
    <tr>
      <td>${escapeHtml(row.libelle)}</td>
      <td>${row.nb}</td>
      <td>${fmtMontant(row.montantPriseEnCharge) ?? 0}${note}</td>
      <td>${fmtMontant(row.montantPatientPaye) ?? 0}</td>
      <td><strong>${fmtMontant(row.total) ?? 0}</strong></td>
    </tr>
  `;
}

async function viewFinancialReport() {
  mount(`
    <div class="card">
      <h2 style="margin-top:0;">Rapport financier</h2>
      <div id="periodControls">${financialPeriodControls()}</div>
      <div class="btn-row">
        <button class="btn" id="generateFinBtn">Générer le rapport</button>
        <button class="btn btn-secondary" id="exportFinBtn">Télécharger en Excel</button>
      </div>
      <div id="finSummary"></div>
    </div>
    <div id="finBody"></div>
  `);

  const resolvePeriod = wirePeriodControls(document.getElementById('periodControls'));
  let lastPeriod = null;

  async function generate() {
    const period = resolvePeriod();
    const summary = document.getElementById('finSummary');
    const body = document.getElementById('finBody');
    if (!period) { summary.innerHTML = '<div class="error-box">Veuillez choisir une période valide.</div>'; return; }
    lastPeriod = period;
    summary.innerHTML = '<p class="muted">Génération du rapport…</p>';
    body.innerHTML = '';
    try {
      const { report } = await apiFetch(`/api/reports/financial?from=${period.from}&to=${period.to}`);
      summary.innerHTML = `
        <div class="info-box">
          Période du ${fmtDate(report.periode.from)} au ${fmtDate(report.periode.to)} — ${report.nbConsultationsAvecPaiement} consultation(s) avec paiement renseigné.
          <br/><strong>Montant total encaissé : ${fmtMontant(report.totalGeneral) ?? 0}</strong>
          (dont prise en charge : ${fmtMontant(report.totalPriseEnCharge) ?? 0} · payé par les patients : ${fmtMontant(report.totalPatientPaye) ?? 0})
        </div>
      `;
      body.innerHTML = `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Type de paiement</th><th>Nb consultations</th><th>Montant pris en charge</th><th>Montant payé par le patient</th><th>Total</th></tr></thead>
              <tbody>${report.parType.map(financialTypeRow).join('')}</tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      summary.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById('generateFinBtn').addEventListener('click', generate);
  document.getElementById('exportFinBtn').addEventListener('click', async () => {
    const period = lastPeriod || resolvePeriod();
    if (!period) return toast('Veuillez choisir une période', true);
    try {
      const blob = await apiFetch(`/api/reports/financial/export?from=${period.from}&to=${period.to}`, { isBlob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport_financier_odonto_${period.from}_au_${period.to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, true);
    }
  });

  generate();
}

// ---------------------------------------------------------------------------
// Vue : gestion des utilisateurs (admin)
// ---------------------------------------------------------------------------
async function viewUsers() {
  mount(`
    <div class="card">
      <h2 style="margin-top:0;">Créer un compte</h2>
      <div id="formError"></div>
      <form id="userForm" class="grid grid-3">
        <div class="field"><label>Nom *</label><input type="text" name="nom" required /></div>
        <div class="field"><label>Prénom *</label><input type="text" name="prenom" required /></div>
        <div class="field">
          <label>Rôle *</label>
          <select name="role"><option value="praticien">Praticien</option><option value="admin">Administrateur</option></select>
        </div>
        <div class="field"><label>Identifiant *</label><input type="text" name="username" required /></div>
        <div class="field"><label>Mot de passe *</label><input type="password" name="password" minlength="6" required /></div>
        <div class="field" style="align-self:end;"><button class="btn" type="submit" style="width:100%;">Créer le compte</button></div>
      </form>
    </div>
    <div class="section-title">Comptes existants</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Statut</th><th></th></tr></thead>
          <tbody id="usersBody"><tr><td colspan="5" class="muted">Chargement…</td></tr></tbody>
        </table>
      </div>
    </div>
  `);

  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: {
          nom: fd.get('nom').trim(), prenom: fd.get('prenom').trim(),
          username: fd.get('username').trim(), password: fd.get('password'), role: fd.get('role'),
        },
      });
      toast('Compte créé');
      e.target.reset();
      loadUsers();
    } catch (err) {
      document.getElementById('formError').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    }
  });

  async function loadUsers() {
    const tbody = document.getElementById('usersBody');
    try {
      const { users } = await apiFetch('/api/users');
      tbody.innerHTML = users.map((u) => `
        <tr>
          <td>${escapeHtml(u.nom)} ${escapeHtml(u.prenom)}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>${u.role === 'admin' ? 'Administrateur' : 'Praticien'}</td>
          <td>${u.actif ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-red">Désactivé</span>'}</td>
          <td class="btn-row">
            <button class="btn btn-secondary btn-sm" data-toggle="${u.id}" data-actif="${u.actif}">${u.actif ? 'Désactiver' : 'Activer'}</button>
            <button class="btn btn-secondary btn-sm" data-reset="${u.id}">Réinitialiser mdp</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await apiFetch(`/api/users/${btn.dataset.toggle}`, { method: 'PUT', body: { actif: btn.dataset.actif !== '1' } });
            loadUsers();
          } catch (err) { toast(err.message, true); }
        });
      });
      tbody.querySelectorAll('[data-reset]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const pwd = window.prompt('Nouveau mot de passe (min. 6 caractères) :');
          if (!pwd) return;
          try {
            await apiFetch(`/api/users/${btn.dataset.reset}`, { method: 'PUT', body: { password: pwd } });
            toast('Mot de passe réinitialisé');
          } catch (err) { toast(err.message, true); }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="error-box">${escapeHtml(err.message)}</div></td></tr>`;
    }
  }

  loadUsers();
}

// ---------------------------------------------------------------------------
// Vue : import d'un registre Excel existant
// ---------------------------------------------------------------------------
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fieldOptionsHtml(catalog, selected) {
  const opt = (value, label) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  let html = opt('ignore', '— Ignorer cette colonne —');
  html += '<optgroup label="Patient">';
  for (const [key, def] of Object.entries(catalog.patient)) html += opt(`patient.${key}`, def.label);
  html += opt('patient.extra', '+ Donnée complémentaire (fiche patient)');
  html += '</optgroup><optgroup label="Consultation">';
  for (const [key, def] of Object.entries(catalog.consultation)) html += opt(`consultation.${key}`, def.label);
  html += opt('consultation.extra', '+ Donnée complémentaire (consultation)');
  html += '</optgroup>';
  return html;
}

function importRowStatusBadge(status) {
  if (status === 'error') return '<span class="badge badge-red">Ignorée</span>';
  if (status === 'warning') return '<span class="badge badge-warn">Avertissement</span>';
  return '<span class="badge badge-green">OK</span>';
}

async function viewImport() {
  // État propre à cette vue (fichier en mémoire entre les étapes, jamais
  // ré-uploadé par l'utilisateur).
  const ctx = { base64: null, headers: null, rows: null, fieldCatalog: null };

  function renderUploadStep(errorHtml = '') {
    mount(`
      <div class="card">
        <h2 style="margin-top:0;">Importer un registre Excel (.xlsx)</h2>
        <p class="muted">
          Choisissez le fichier Excel de votre registre existant. À l'étape suivante, vous pourrez vérifier et
          corriger la correspondance entre les colonnes du fichier et les champs de l'application avant toute
          importation : rien n'est enregistré à cette étape.
        </p>
        ${errorHtml}
        <div class="field">
          <label>Fichier Excel (.xlsx) *</label>
          <input type="file" id="importFile" accept=".xlsx" />
        </div>
        <button class="btn" id="analyzeBtn" disabled>Analyser le fichier</button>
      </div>
    `);

    const fileInput = document.getElementById('importFile');
    const analyzeBtn = document.getElementById('analyzeBtn');
    let selectedFile = null;

    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files[0] || null;
      analyzeBtn.disabled = !selectedFile;
    });

    analyzeBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Analyse en cours…';
      try {
        const buf = await selectedFile.arrayBuffer();
        const base64 = arrayBufferToBase64(buf);
        const preview = await apiFetch('/api/import/preview', { method: 'POST', body: { contentBase64: base64 } });
        ctx.base64 = base64;
        ctx.headers = preview.headers;
        ctx.fieldCatalog = preview.fieldCatalog;
        renderMappingStep(preview);
      } catch (err) {
        renderUploadStep(`<div class="error-box">${escapeHtml(err.message)}</div>`);
      }
    });
  }

  function renderMappingStep(preview) {
    const { headers, totalRows, sampleRows, mappingSuggestions, fieldCatalog } = preview;
    const sampleFor = (i) => {
      const vals = sampleRows.map((r) => r[i]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
      return vals.slice(0, 2).map((v) => escapeHtml(String(v))).join(' / ') || '<span class="muted">—</span>';
    };

    mount(`
      <div class="card">
        <h2 style="margin-top:0;">Correspondance des colonnes</h2>
        <p class="muted">
          ${totalRows} ligne(s) de données trouvée(s). Vérifiez la correspondance suggérée pour chaque colonne
          avant de poursuivre — une colonne non reconnue n'est <strong>jamais</strong> importée tant que vous ne
          choisissez pas explicitement « Donnée complémentaire » ou le champ correspondant.
        </p>
        <div id="mappingError"></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Colonne du fichier</th><th>Exemple de valeurs</th><th>Correspond à</th></tr></thead>
            <tbody id="mappingBody">
              ${headers.map((h, i) => `
                <tr>
                  <td><strong>${escapeHtml(h || '(sans titre)')}</strong></td>
                  <td>${sampleFor(i)}</td>
                  <td><select data-col="${i}">${fieldOptionsHtml(fieldCatalog, mappingSuggestions[i].suggestion || 'ignore')}</select></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn btn-ghost" id="backBtn">← Choisir un autre fichier</button>
          <button class="btn" id="commitBtn">Vérifier et importer</button>
        </div>
      </div>
    `);

    document.getElementById('backBtn').addEventListener('click', () => renderUploadStep());
    document.getElementById('commitBtn').addEventListener('click', async () => {
      const mapping = {};
      document.querySelectorAll('#mappingBody select[data-col]').forEach((sel) => {
        mapping[sel.dataset.col] = sel.value;
      });
      if (!Object.values(mapping).some((v) => v && v !== 'ignore')) {
        document.getElementById('mappingError').innerHTML =
          '<div class="error-box">Choisissez au moins une colonne à importer.</div>';
        return;
      }
      const commitBtn = document.getElementById('commitBtn');
      commitBtn.disabled = true;
      commitBtn.textContent = 'Importation en cours…';
      try {
        const { report } = await apiFetch('/api/import/commit', { method: 'POST', body: { contentBase64: ctx.base64, mapping } });
        renderResultStep(report);
      } catch (err) {
        document.getElementById('mappingError').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
        commitBtn.disabled = false;
        commitBtn.textContent = 'Vérifier et importer';
      }
    });
  }

  function renderResultStep(report) {
    const customList = (items) => (items.length ? items.map((i) => escapeHtml(i.libelle)).join(', ') : 'aucun');
    mount(`
      <div class="card">
        <h2 style="margin-top:0;">Résultat de l'import</h2>
        <div class="grid grid-3">
          <div class="stat"><div class="stat-value">${report.patients.created}</div><div class="stat-label">patients créés</div></div>
          <div class="stat"><div class="stat-value">${report.patients.matched}</div><div class="stat-label">patients déjà existants (enrichis)</div></div>
          <div class="stat"><div class="stat-value">${report.patients.ambiguous}</div><div class="stat-label">lignes ambiguës ignorées</div></div>
          <div class="stat"><div class="stat-value">${report.consultations.created}</div><div class="stat-label">consultations créées</div></div>
          <div class="stat"><div class="stat-value">${report.consultations.skipped}</div><div class="stat-label">consultations non créées</div></div>
          <div class="stat"><div class="stat-value">${report.totalRows}</div><div class="stat-label">lignes traitées</div></div>
        </div>
        <p style="margin-top:14px;">
          Nouveaux diagnostics ajoutés à la liste de référence : ${customList(report.customPathologiesCreated)}.<br/>
          Nouveaux traitements ajoutés à la liste de référence : ${customList(report.customTraitementsCreated)}.
        </p>
      </div>
      <div class="section-title">Détail ligne par ligne</div>
      <div class="card">
        <div class="table-wrap" style="max-height:420px; overflow-y:auto;">
          <table>
            <thead><tr><th>Ligne</th><th>Statut</th><th>Détails</th></tr></thead>
            <tbody>
              ${report.rows.map((r) => `
                <tr>
                  <td>${r.rowNumber}</td>
                  <td>${importRowStatusBadge(r.status)}</td>
                  <td>${r.messages.length ? escapeHtml(r.messages.join(' · ')) : '<span class="muted">—</span>'}</td>
                </tr>
              `).join('') || '<tr><td colspan="3" class="muted">Aucune ligne.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn" id="newImportBtn">Importer un autre fichier</button>
        </div>
      </div>
    `);
    document.getElementById('newImportBtn').addEventListener('click', () => renderUploadStep());
  }

  renderUploadStep();
}

// ---------------------------------------------------------------------------
// Routeur (basé sur le hash)
// ---------------------------------------------------------------------------
const ROUTES = [
  { pattern: /^#\/login$/, view: viewLogin, public: true },
  { pattern: /^#\/patients$/, view: viewPatients },
  { pattern: /^#\/patients\/new$/, view: viewPatientNew },
  { pattern: /^#\/patients\/(\d+)\/consultations\/new$/, view: (m) => viewConsultationForm(m[1], null) },
  { pattern: /^#\/patients\/(\d+)\/consultations\/(\d+)$/, view: (m) => viewConsultationForm(m[1], m[2]) },
  { pattern: /^#\/patients\/(\d+)$/, view: (m) => viewPatientDetail(m[1]) },
  { pattern: /^#\/reports$/, view: viewReports, roles: ['admin', 'praticien'] },
  { pattern: /^#\/reports\/financier$/, view: viewFinancialReport, roles: ['admin', 'praticien'] },
  { pattern: /^#\/users$/, view: viewUsers, roles: ['admin'] },
  { pattern: /^#\/import$/, view: viewImport, roles: ['admin'] },
];

async function route() {
  const hash = location.hash || '#/patients';

  if (!state.user) {
    if (hash !== '#/login') { location.hash = '#/login'; return; }
    renderTopbar();
    viewLogin();
    return;
  }

  if (hash === '#/login') { location.hash = '#/patients'; return; }

  await ensureReference().catch(() => {});
  renderTopbar();

  for (const r of ROUTES) {
    const m = hash.match(r.pattern);
    if (!m) continue;
    if (r.roles && !r.roles.includes(state.user.role)) {
      mount('<div class="error-box">Accès réservé aux administrateurs.</div>');
      return;
    }
    r.view(m);
    return;
  }
  mount('<div class="empty-state">Page introuvable.</div>');
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
async function bootstrap() {
  if (getToken()) {
    try {
      const { user } = await apiFetch('/api/auth/me');
      state.user = user;
    } catch {
      clearSession();
      state.user = null;
    }
  }
  route();
}

bootstrap();
