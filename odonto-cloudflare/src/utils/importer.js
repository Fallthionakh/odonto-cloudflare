// Cœur de la fonctionnalité d'import Excel — version Cloudflare Worker
// (Supabase/PostgREST au lieu de SQLite). Même comportement et mêmes règles
// que odonto-app/src/utils/importer.js :
//   1. Ne jamais inventer : une valeur manquante ou non reconnue reste
//      vide et est signalée dans le compte-rendu, jamais devinée.
//   2. Garder la cohérence : les diagnostics/traitements inconnus passent
//      par le même mécanisme que le bouton « + Ajouter » de l'interface
//      (dédoublonnage inclus) ; les patients déjà existants ne sont
//      qu'enrichis (jamais écrasés) ; les doublons ambigus sont signalés
//      plutôt que fusionnés au hasard.
//   3. Les rubriques choisies comme « donnée complémentaire » sont
//      conservées telles quelles (texte brut), jamais interprétées.
'use strict';

import { sbSelect, sbInsert, sbUpdate } from '../supabase.js';
import { normalizeText, fieldCatalog, coerceFieldValue, splitListValue } from './importMapping.js';
import { allPathologies, allTreatments, addCustomPathologie, addCustomTraitement } from './customReference.js';

function generateNumeroDossier(id) {
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return `ODT-${stamp}-${String(id).padStart(4, '0')}`;
}

function appendComplementaire(existing, lines) {
  if (!lines.length) return existing || null;
  const current = existing ? existing.split('\n').filter(Boolean) : [];
  const currentSet = new Set(current.map((l) => l.trim()));
  for (const line of lines) {
    if (!currentSet.has(line.trim())) {
      current.push(line);
      currentSet.add(line.trim());
    }
  }
  return current.join('\n') || null;
}

function splitRowByMapping(headers, row, mapping) {
  const patientValues = {};
  const consultationValues = {};
  const patientExtra = [];
  const consultationExtra = [];

  for (let i = 0; i < headers.length; i++) {
    const target = mapping[String(i)];
    if (!target || target === 'ignore') continue;
    const raw = row[i];
    const isEmpty = raw === null || raw === undefined || String(raw).trim() === '';

    if (target === 'patient.extra') {
      if (!isEmpty) patientExtra.push(`${headers[i]}: ${String(raw).trim()}`);
      continue;
    }
    if (target === 'consultation.extra') {
      if (!isEmpty) consultationExtra.push(`${headers[i]}: ${String(raw).trim()}`);
      continue;
    }
    const dot = target.indexOf('.');
    if (dot === -1) continue;
    const entity = target.slice(0, dot);
    const field = target.slice(dot + 1);
    if (entity === 'patient') patientValues[field] = raw;
    else if (entity === 'consultation') consultationValues[field] = raw;
  }

  return { patientValues, consultationValues, patientExtra, consultationExtra };
}

function rowHasConsultationData(consultationValues, consultationExtra) {
  if (consultationExtra.length) return true;
  return Object.values(consultationValues).some((v) => v !== null && v !== undefined && String(v).trim() !== '');
}

function matchExistingPatient(patients, { numeroDossier, nom, prenom, dateNaissance }) {
  if (numeroDossier) {
    const byDossier = patients.find((p) => p.numero_dossier === numeroDossier);
    if (byDossier) {
      const sameIdentity = normalizeText(byDossier.nom) === normalizeText(nom) && normalizeText(byDossier.prenom) === normalizeText(prenom);
      return { patient: byDossier, conflict: !sameIdentity };
    }
  }
  const candidates = patients.filter((p) => normalizeText(p.nom) === normalizeText(nom) && normalizeText(p.prenom) === normalizeText(prenom));
  if (dateNaissance) {
    const withDob = candidates.filter((p) => p.date_naissance === dateNaissance);
    if (withDob.length === 1) return { patient: withDob[0], conflict: false };
    if (withDob.length > 1) return { patient: null, ambiguous: true };
  }
  if (candidates.length === 1) return { patient: candidates[0], conflict: false };
  if (candidates.length > 1) return { patient: null, ambiguous: true };
  return { patient: null, conflict: false };
}

// Les libellés officiels portent souvent un préfixe de code ("K051 - Gingivite
// chronique", "K00- Troubles de l'odontogénèse") qu'un fichier Excel de
// terrain ne reprend presque jamais. On retire ce préfixe pour la
// comparaison uniquement (jamais pour l'affichage).
function stripCodePrefix(text) {
  return String(text || '').replace(/^[A-Za-z0-9]+\s*[-–]\s*/, '').trim();
}

function candidateTexts(item) {
  const texts = new Set();
  for (const raw of [item.libelle, item.categorie, item.id]) {
    if (!raw) continue;
    texts.add(normalizeText(raw));
    texts.add(normalizeText(stripCodePrefix(raw)));
  }
  return texts;
}

async function matchReferenceTokens(env, tokens, listFn, addFn, userId, createdTracker) {
  const ids = [];
  for (const token of tokens) {
    const norm = normalizeText(token);
    const current = await listFn(env);
    const existing = current.find((item) => candidateTexts(item).has(norm));
    if (existing) {
      ids.push(existing.id);
    } else {
      const created = await addFn(env, token, userId);
      ids.push(created.id);
      if (!created.existed && !createdTracker.has(created.id)) {
        createdTracker.set(created.id, created.libelle);
      }
    }
  }
  return ids;
}

/**
 * Traite l'ensemble des lignes d'un import déjà mappé et confirmé par
 * l'utilisateur. Renvoie un compte-rendu détaillé (une ligne individuelle
 * invalide est simplement signalée et ignorée, le reste de l'import continue).
 */
export async function commitImport(env, { headers, rows, mapping }, userId) {
  const catalog = fieldCatalog();
  const patients = (await sbSelect(env, 'odonto_patients', 'select=*')) || [];
  const customPathologiesCreated = new Map();
  const customTraitementsCreated = new Map();
  const matchedPatientIds = new Set();
  const createdPatientIds = new Set();
  const rowReports = [];

  let consultationsCreated = 0;
  let consultationsSkipped = 0;
  let patientsAmbiguous = 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowNumber = r + 2; // +1 pour l'en-tête, +1 pour passer en 1-based
    const messages = [];
    const { patientValues, consultationValues, patientExtra, consultationExtra } = splitRowByMapping(headers, row, mapping);

    const nom = patientValues.nom != null ? String(patientValues.nom).trim() : '';
    const prenom = patientValues.prenom != null ? String(patientValues.prenom).trim() : '';
    if (!nom || !prenom) {
      rowReports.push({ rowNumber, status: 'error', messages: ['nom et/ou prénom manquant — ligne ignorée'] });
      continue;
    }
    const sexeResult = coerceFieldValue(patientValues.sexe, catalog.patient.sexe);
    if (!sexeResult.value) {
      rowReports.push({ rowNumber, status: 'error', messages: [sexeResult.warning || 'sexe manquant ou non reconnu — ligne ignorée'] });
      continue;
    }
    const sexe = sexeResult.value;

    const dateNaissanceResult = coerceFieldValue(patientValues.date_naissance, catalog.patient.date_naissance);
    if (dateNaissanceResult.warning) messages.push(dateNaissanceResult.warning);
    const telephone = patientValues.telephone != null ? String(patientValues.telephone).trim() || null : null;
    const adresse = patientValues.adresse != null ? String(patientValues.adresse).trim() || null : null;
    const contactNom = patientValues.contact_nom != null ? String(patientValues.contact_nom).trim() || null : null;
    const contactTelephone = patientValues.contact_telephone != null ? String(patientValues.contact_telephone).trim() || null : null;
    const numeroDossierRaw = patientValues.numero_dossier != null ? String(patientValues.numero_dossier).trim() || null : null;

    const { patient: foundPatient, conflict, ambiguous } = matchExistingPatient(patients, {
      numeroDossier: numeroDossierRaw,
      nom,
      prenom,
      dateNaissance: dateNaissanceResult.value,
    });

    if (ambiguous) {
      patientsAmbiguous += 1;
      rowReports.push({
        rowNumber,
        status: 'error',
        messages: ['plusieurs patients existants correspondent à ce nom/prénom — ligne ignorée (à traiter manuellement)'],
      });
      continue;
    }
    if (conflict) {
      patientsAmbiguous += 1;
      rowReports.push({
        rowNumber,
        status: 'error',
        messages: [`le numéro de dossier « ${numeroDossierRaw} » correspond à un autre patient — ligne ignorée (à vérifier manuellement)`],
      });
      continue;
    }

    let patient = foundPatient;
    if (patient) {
      const mergedExtra = appendComplementaire(patient.donnees_complementaires, patientExtra);
      const updated = await sbUpdate(env, 'odonto_patients', `id=eq.${patient.id}`, {
        date_naissance: patient.date_naissance ?? dateNaissanceResult.value,
        telephone: patient.telephone ?? telephone,
        adresse: patient.adresse ?? adresse,
        contact_nom: patient.contact_nom ?? contactNom,
        contact_telephone: patient.contact_telephone ?? contactTelephone,
        numero_dossier: patient.numero_dossier ?? numeroDossierRaw,
        donnees_complementaires: mergedExtra,
      });
      patient = updated[0];
      const idx = patients.findIndex((p) => p.id === patient.id);
      if (idx !== -1) patients[idx] = patient;
      matchedPatientIds.add(patient.id);
    } else {
      const created = await sbInsert(env, 'odonto_patients', [
        {
          nom,
          prenom,
          date_naissance: dateNaissanceResult.value,
          sexe,
          telephone,
          adresse,
          contact_nom: contactNom,
          contact_telephone: contactTelephone,
          donnees_complementaires: patientExtra.length ? patientExtra.join('\n') : null,
          created_by: userId || null,
        },
      ]);
      const newId = created[0].id;
      const numeroDossier = numeroDossierRaw || generateNumeroDossier(newId);
      const updated = await sbUpdate(env, 'odonto_patients', `id=eq.${newId}`, { numero_dossier: numeroDossier });
      patient = updated[0];
      patients.push(patient);
      createdPatientIds.add(patient.id);
    }

    if (!rowHasConsultationData(consultationValues, consultationExtra)) {
      rowReports.push({ rowNumber, status: messages.length ? 'warning' : 'ok', patientId: patient.id, messages });
      continue;
    }

    const dateConsultationResult = coerceFieldValue(consultationValues.date_consultation, catalog.consultation.date_consultation);
    if (!dateConsultationResult.value) {
      consultationsSkipped += 1;
      messages.push('date_consultation manquante ou invalide — consultation non créée pour cette ligne (patient tout de même enregistré)');
      rowReports.push({ rowNumber, status: 'warning', patientId: patient.id, messages });
      continue;
    }

    const existingConsultations = (await sbSelect(env, 'odonto_consultations', `select=id&patient_id=eq.${patient.id}`)) || [];
    const typeCasResult = coerceFieldValue(consultationValues.type_cas, catalog.consultation.type_cas);
    if (typeCasResult.warning) messages.push(typeCasResult.warning);
    const typeCas = typeCasResult.value || (existingConsultations.length > 0 ? 'ancien' : 'nouveau');

    const statutRefResult = coerceFieldValue(consultationValues.statut_reference, catalog.consultation.statut_reference);
    if (statutRefResult.warning) messages.push(statutRefResult.warning);
    const statutReference = statutRefResult.value || 'aucun';

    const issueResult = coerceFieldValue(consultationValues.issue, catalog.consultation.issue);
    if (issueResult.warning) messages.push(issueResult.warning);
    const issue = issueResult.value || 'vivant';

    let causeDecesId = null;
    if (issue === 'decede') {
      const causeResult = coerceFieldValue(consultationValues.cause_deces, catalog.consultation.cause_deces);
      causeDecesId = causeResult.value;
      if (!causeDecesId) messages.push("issue déclarée « décédé » mais aucune cause de décès reconnue dans le fichier — enregistrée sans cause");
    }

    const grossesseResult = coerceFieldValue(consultationValues.grossesse, catalog.consultation.grossesse);
    const grossesse = sexe === 'F' && grossesseResult.value;

    const motif = consultationValues.motif != null ? String(consultationValues.motif).trim() || null : null;
    const antecedents = consultationValues.antecedents != null ? String(consultationValues.antecedents).trim() || null : null;
    const examenClinique = consultationValues.examen_clinique != null ? String(consultationValues.examen_clinique).trim() || null : null;
    const catObservation = consultationValues.cat_observation != null ? String(consultationValues.cat_observation).trim() || null : null;

    const rdvResult = coerceFieldValue(consultationValues.rendez_vous_suivi, catalog.consultation.rendez_vous_suivi);
    if (rdvResult.warning) messages.push(rdvResult.warning);

    const typePaiementResult = coerceFieldValue(consultationValues.type_paiement, catalog.consultation.type_paiement);
    if (typePaiementResult.warning) messages.push(typePaiementResult.warning);

    const montantPECResult = coerceFieldValue(consultationValues.montant_prise_en_charge, catalog.consultation.montant_prise_en_charge);
    if (montantPECResult.warning) messages.push(montantPECResult.warning);
    const montantPatientResult = coerceFieldValue(consultationValues.montant_patient_paye, catalog.consultation.montant_patient_paye);
    if (montantPatientResult.warning) messages.push(montantPatientResult.warning);

    const diagnosticTokens = splitListValue(consultationValues.diagnostics);
    const diagnosticIds = await matchReferenceTokens(env, diagnosticTokens, allPathologies, addCustomPathologie, userId, customPathologiesCreated);
    const traitementTokens = splitListValue(consultationValues.traitements);
    const traitementIds = await matchReferenceTokens(env, traitementTokens, allTreatments, addCustomTraitement, userId, customTraitementsCreated);

    const createdConsultation = await sbInsert(env, 'odonto_consultations', [
      {
        patient_id: patient.id,
        date_consultation: dateConsultationResult.value,
        type_cas: typeCas,
        statut_reference: statutReference,
        motif,
        antecedents,
        examen_clinique: examenClinique,
        cat_observation: catObservation,
        grossesse,
        issue,
        cause_deces_id: causeDecesId,
        rendez_vous_suivi: rdvResult.value,
        praticien_id: userId || null,
        type_paiement: typePaiementResult.value,
        montant_prise_en_charge: montantPECResult.value,
        montant_patient_paye: montantPatientResult.value,
        donnees_complementaires: consultationExtra.length ? consultationExtra.join('\n') : null,
      },
    ]);
    const consultationId = createdConsultation[0].id;

    if (diagnosticIds.length) {
      await sbInsert(
        env,
        'odonto_consultation_diagnostics',
        diagnosticIds.map((id) => ({ consultation_id: consultationId, pathologie_id: id })),
        { returning: false }
      );
    }
    if (traitementIds.length) {
      await sbInsert(
        env,
        'odonto_consultation_traitements',
        traitementIds.map((id) => ({ consultation_id: consultationId, traitement_id: id })),
        { returning: false }
      );
    }
    consultationsCreated += 1;

    rowReports.push({ rowNumber, status: messages.length ? 'warning' : 'ok', patientId: patient.id, consultationId, messages });
  }

  return {
    totalRows: rows.length,
    patients: {
      created: createdPatientIds.size,
      matched: matchedPatientIds.size,
      ambiguous: patientsAmbiguous,
    },
    consultations: {
      created: consultationsCreated,
      skipped: consultationsSkipped,
    },
    customPathologiesCreated: [...customPathologiesCreated.entries()].map(([id, libelle]) => ({ id, libelle })),
    customTraitementsCreated: [...customTraitementsCreated.entries()].map(([id, libelle]) => ({ id, libelle })),
    rows: rowReports,
  };
}
