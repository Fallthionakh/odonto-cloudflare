'use strict';

import { HttpError, json, readJsonBody } from '../router.js';
import { requireAuth } from '../auth.js';
import { sbSelect, sbInsert, sbUpdate } from '../supabase.js';

function validatePatientBody(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.nom !== undefined) if (!body.nom) errors.push('nom');
  if (!partial || body.prenom !== undefined) if (!body.prenom) errors.push('prenom');
  if (!partial || body.sexe !== undefined) {
    if (!['M', 'F'].includes(body.sexe)) errors.push('sexe');
  }
  if (errors.length) throw new HttpError(400, `Champs invalides ou manquants : ${errors.join(', ')}`);
}

// Construit un filtre PostgREST `or=(...)` à partir d'un texte de recherche
// libre, sur plusieurs colonnes (équivalent du `LIKE` multi-colonnes SQLite).
function orIlikeFilter(q, columns) {
  const safe = String(q).replace(/[(),]/g, ' ').trim();
  const pattern = `*${safe}*`;
  return `or=(${columns.map((c) => `${c}.ilike.${encodeURIComponent(pattern)}`).join(',')})`;
}

function finalizeConsultation(c) {
  c.diagnostics = (c.odonto_consultation_diagnostics || []).map((r) => r.pathologie_id);
  c.traitements = (c.odonto_consultation_traitements || []).map((r) => r.traitement_id);
  delete c.odonto_consultation_diagnostics;
  delete c.odonto_consultation_traitements;
  return c;
}

export function register(router) {
  router.get('/api/patients', async (ctx) => {
    await requireAuth(ctx);
    const q = (ctx.url.searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(ctx.url.searchParams.get('limit') || '50', 10) || 50, 200);

    let query = `select=*&order=created_at.desc&limit=${limit}`;
    if (q) {
      query += `&${orIlikeFilter(q, ['nom', 'prenom', 'numero_dossier', 'telephone'])}`;
    }
    const rows = (await sbSelect(ctx.env, 'odonto_patients', query)) || [];
    return json(200, { patients: rows });
  });

  router.post('/api/patients', async (ctx) => {
    const user = await requireAuth(ctx);
    const body = await readJsonBody(ctx.request);
    validatePatientBody(body);

    const createdRows = await sbInsert(ctx.env, 'odonto_patients', [
      {
        nom: body.nom.trim(),
        prenom: body.prenom.trim(),
        date_naissance: body.date_naissance || null,
        sexe: body.sexe,
        telephone: body.telephone || null,
        adresse: body.adresse || null,
        contact_nom: body.contact_nom || null,
        contact_telephone: body.contact_telephone || null,
        created_by: user.id,
      },
    ]);
    const id = createdRows[0].id;
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const numeroDossier = `ODT-${stamp}-${String(id).padStart(4, '0')}`;
    const updated = await sbUpdate(ctx.env, 'odonto_patients', `id=eq.${id}`, { numero_dossier: numeroDossier });

    return json(201, { patient: updated[0] });
  });

  router.get('/api/patients/:id', async (ctx) => {
    await requireAuth(ctx);
    const patientRows = await sbSelect(ctx.env, 'odonto_patients', `select=*&id=eq.${encodeURIComponent(ctx.params.id)}`);
    const patient = patientRows && patientRows[0];
    if (!patient) throw new HttpError(404, 'Patient introuvable');

    const consultations =
      (await sbSelect(
        ctx.env,
        'odonto_consultations',
        `select=*,odonto_consultation_diagnostics(pathologie_id),odonto_consultation_traitements(traitement_id)&patient_id=eq.${encodeURIComponent(
          patient.id
        )}&order=date_consultation.desc,id.desc`
      )) || [];

    consultations.forEach(finalizeConsultation);

    return json(200, { patient, consultations });
  });

  router.put('/api/patients/:id', async (ctx) => {
    await requireAuth(ctx);
    const existingRows = await sbSelect(ctx.env, 'odonto_patients', `select=*&id=eq.${encodeURIComponent(ctx.params.id)}`);
    const existing = existingRows && existingRows[0];
    if (!existing) throw new HttpError(404, 'Patient introuvable');

    const body = await readJsonBody(ctx.request);
    validatePatientBody(body, { partial: true });

    const merged = {
      nom: body.nom !== undefined ? body.nom.trim() : existing.nom,
      prenom: body.prenom !== undefined ? body.prenom.trim() : existing.prenom,
      date_naissance: body.date_naissance !== undefined ? body.date_naissance : existing.date_naissance,
      sexe: body.sexe !== undefined ? body.sexe : existing.sexe,
      telephone: body.telephone !== undefined ? body.telephone : existing.telephone,
      adresse: body.adresse !== undefined ? body.adresse : existing.adresse,
      contact_nom: body.contact_nom !== undefined ? body.contact_nom : existing.contact_nom,
      contact_telephone: body.contact_telephone !== undefined ? body.contact_telephone : existing.contact_telephone,
    };

    const updated = await sbUpdate(ctx.env, 'odonto_patients', `id=eq.${encodeURIComponent(existing.id)}`, merged);

    return json(200, { patient: updated[0] });
  });
}
