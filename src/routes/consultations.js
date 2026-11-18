'use strict';

import { HttpError, json, readJsonBody } from '../router.js';
import { requireAuth } from '../auth.js';
import { sbSelect, sbInsert, sbUpdate, sbDelete } from '../supabase.js';
import indicateurs from '../data/indicateurs.js';
import { allPathologies, allTreatments } from '../utils/customReference.js';

const CAUSE_DECES_IDS = new Set(indicateurs.mortalite.map((m) => m.id));
const TYPE_CAS = new Set(['nouveau', 'ancien']);
const STATUT_REF = new Set(['aucun', 'refere', 'contre_refere', 'vu_par_reference']);
const ISSUES = new Set(['vivant', 'decede']);
const TYPES_PAIEMENT = new Set(['PAF', 'LG', 'PERSONNEL', 'CAS_SOCIAL']);

function parseMontant(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Montant invalide');
  return n;
}

function validatePaiement(body) {
  const typePaiement = body.type_paiement || null;
  if (typePaiement !== null && !TYPES_PAIEMENT.has(typePaiement)) {
    throw new HttpError(400, 'type_paiement invalide');
  }
  const montantPriseEnCharge = parseMontant(body.montant_prise_en_charge);
  const montantPatientPaye = parseMontant(body.montant_patient_paye);
  return { typePaiement, montantPriseEnCharge, montantPatientPaye };
}

function finalizeConsultation(c) {
  c.diagnostics = (c.odonto_consultation_diagnostics || []).map((r) => r.pathologie_id);
  c.traitements = (c.odonto_consultation_traitements || []).map((r) => r.traitement_id);
  delete c.odonto_consultation_diagnostics;
  delete c.odonto_consultation_traitements;
  return c;
}

async function loadConsultationExtras(env, consultation) {
  const diagRows = (await sbSelect(env, 'odonto_consultation_diagnostics', `select=pathologie_id&consultation_id=eq.${consultation.id}`)) || [];
  const traitRows = (await sbSelect(env, 'odonto_consultation_traitements', `select=traitement_id&consultation_id=eq.${consultation.id}`)) || [];
  consultation.diagnostics = diagRows.map((r) => r.pathologie_id);
  consultation.traitements = traitRows.map((r) => r.traitement_id);
  return consultation;
}

async function validateBody(env, body) {
  const diagnostics = Array.isArray(body.diagnostics) ? body.diagnostics : [];
  const traitements = Array.isArray(body.traitements) ? body.traitements : [];

  const pathologieIds = new Set((await allPathologies(env)).map((p) => p.id));
  const traitementIds = new Set((await allTreatments(env)).map((t) => t.id));
  for (const d of diagnostics) {
    if (!pathologieIds.has(d)) throw new HttpError(400, `Diagnostic inconnu : ${d}`);
  }
  for (const t of traitements) {
    if (!traitementIds.has(t)) throw new HttpError(400, `Traitement inconnu : ${t}`);
  }
  const typeCas = body.type_cas || 'nouveau';
  if (!TYPE_CAS.has(typeCas)) throw new HttpError(400, 'type_cas invalide');
  const statutReference = body.statut_reference || 'aucun';
  if (!STATUT_REF.has(statutReference)) throw new HttpError(400, 'statut_reference invalide');
  const issue = body.issue || 'vivant';
  if (!ISSUES.has(issue)) throw new HttpError(400, 'issue invalide');
  if (issue === 'decede' && !CAUSE_DECES_IDS.has(body.cause_deces_id)) {
    throw new HttpError(400, 'Une cause de décès valide est requise lorsque l’issue est « décédé »');
  }
  if (!body.date_consultation) throw new HttpError(400, 'date_consultation requise');

  return { diagnostics, traitements, typeCas, statutReference, issue };
}

export function register(router) {
  router.post('/api/patients/:patientId/consultations', async (ctx) => {
    const user = await requireAuth(ctx);
    const patientRows = await sbSelect(ctx.env, 'odonto_patients', `select=*&id=eq.${encodeURIComponent(ctx.params.patientId)}`);
    const patient = patientRows && patientRows[0];
    if (!patient) throw new HttpError(404, 'Patient introuvable');

    const body = await readJsonBody(ctx.request);
    const { diagnostics, traitements, typeCas, statutReference, issue } = await validateBody(ctx.env, body);
    const { typePaiement, montantPriseEnCharge, montantPatientPaye } = validatePaiement(body);
    const grossesse = patient.sexe === 'F' && !!body.grossesse;

    const created = await sbInsert(ctx.env, 'odonto_consultations', [
      {
        patient_id: patient.id,
        date_consultation: body.date_consultation,
        type_cas: typeCas,
        statut_reference: statutReference,
        motif: body.motif || null,
        antecedents: body.antecedents || null,
        examen_clinique: body.examen_clinique || null,
        cat_observation: body.cat_observation || null,
        grossesse,
        issue,
        cause_deces_id: issue === 'decede' ? body.cause_deces_id : null,
        rendez_vous_suivi: body.rendez_vous_suivi || null,
        praticien_id: user.id,
        type_paiement: typePaiement,
        montant_prise_en_charge: montantPriseEnCharge,
        montant_patient_paye: montantPatientPaye,
      },
    ]);
    const consultationId = created[0].id;

    if (diagnostics.length) {
      await sbInsert(
        ctx.env,
        'odonto_consultation_diagnostics',
        diagnostics.map((d) => ({ consultation_id: consultationId, pathologie_id: d })),
        { returning: false }
      );
    }
    if (traitements.length) {
      await sbInsert(
        ctx.env,
        'odonto_consultation_traitements',
        traitements.map((t) => ({ consultation_id: consultationId, traitement_id: t })),
        { returning: false }
      );
    }

    const result = await loadConsultationExtras(ctx.env, created[0]);
    return json(201, { consultation: result });
  });

  router.get('/api/consultations/:id', async (ctx) => {
    await requireAuth(ctx);
    const rows = await sbSelect(
      ctx.env,
      'odonto_consultations',
      `select=*,odonto_consultation_diagnostics(pathologie_id),odonto_consultation_traitements(traitement_id)&id=eq.${encodeURIComponent(
        ctx.params.id
      )}`
    );
    const consultation = rows && rows[0];
    if (!consultation) throw new HttpError(404, 'Consultation introuvable');
    return json(200, { consultation: finalizeConsultation(consultation) });
  });

  router.put('/api/consultations/:id', async (ctx) => {
    await requireAuth(ctx);
    const existingRows = await sbSelect(ctx.env, 'odonto_consultations', `select=*&id=eq.${encodeURIComponent(ctx.params.id)}`);
    const existing = existingRows && existingRows[0];
    if (!existing) throw new HttpError(404, 'Consultation introuvable');
    const patientRows = await sbSelect(ctx.env, 'odonto_patients', `select=*&id=eq.${encodeURIComponent(existing.patient_id)}`);
    const patient = patientRows && patientRows[0];

    const body = await readJsonBody(ctx.request);
    const merged = { ...existing, ...body };
    const { diagnostics, traitements, typeCas, statutReference, issue } = await validateBody(ctx.env, merged);
    const { typePaiement, montantPriseEnCharge, montantPatientPaye } = validatePaiement(merged);
    const grossesse = patient.sexe === 'F' && !!merged.grossesse;

    const updatedRows = await sbUpdate(ctx.env, 'odonto_consultations', `id=eq.${encodeURIComponent(existing.id)}`, {
      date_consultation: merged.date_consultation,
      type_cas: typeCas,
      statut_reference: statutReference,
      motif: merged.motif || null,
      antecedents: merged.antecedents || null,
      examen_clinique: merged.examen_clinique || null,
      cat_observation: merged.cat_observation || null,
      grossesse,
      issue,
      cause_deces_id: issue === 'decede' ? merged.cause_deces_id : null,
      rendez_vous_suivi: merged.rendez_vous_suivi || null,
      type_paiement: typePaiement,
      montant_prise_en_charge: montantPriseEnCharge,
      montant_patient_paye: montantPatientPaye,
    });

    if (body.diagnostics !== undefined) {
      await sbDelete(ctx.env, 'odonto_consultation_diagnostics', `consultation_id=eq.${existing.id}`);
      if (diagnostics.length) {
        await sbInsert(
          ctx.env,
          'odonto_consultation_diagnostics',
          diagnostics.map((d) => ({ consultation_id: existing.id, pathologie_id: d })),
          { returning: false }
        );
      }
    }
    if (body.traitements !== undefined) {
      await sbDelete(ctx.env, 'odonto_consultation_traitements', `consultation_id=eq.${existing.id}`);
      if (traitements.length) {
        await sbInsert(
          ctx.env,
          'odonto_consultation_traitements',
          traitements.map((t) => ({ consultation_id: existing.id, traitement_id: t })),
          { returning: false }
        );
      }
    }

    const result = await loadConsultationExtras(ctx.env, updatedRows[0]);
    return json(200, { consultation: result });
  });
}
