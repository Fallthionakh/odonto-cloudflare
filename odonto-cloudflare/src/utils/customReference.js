// Gère les diagnostics et traitements ajoutés à la volée par les
// utilisateurs (liste de référence « intelligente »), en complément des
// listes fixes (src/data/pathologies.js, src/data/treatments.js).
// Version Cloudflare Worker : les éléments personnalisés vivent dans les
// tables Supabase odonto_custom_pathologies / odonto_custom_traitements au
// lieu de SQLite.
'use strict';

import { HttpError } from '../router.js';
import { sbSelect, sbInsert } from '../supabase.js';
import staticPathologies from '../data/pathologies.js';
import staticTreatments from '../data/treatments.js';

export const CUSTOM_CATEGORIE = 'Autres (ajoutés)';

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function slugify(text) {
  const slug = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return slug || 'ITEM';
}

function makeId(prefix, text, existingIds) {
  const base = `${prefix}_${slugify(text)}`;
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

export async function listCustomPathologies(env) {
  return (await sbSelect(env, 'odonto_custom_pathologies', 'select=id,libelle,categorie&order=created_at')) || [];
}

export async function listCustomTraitements(env) {
  return (await sbSelect(env, 'odonto_custom_traitements', 'select=id,libelle&order=created_at')) || [];
}

export async function allPathologies(env) {
  return [...staticPathologies, ...(await listCustomPathologies(env))];
}

export async function allTreatments(env) {
  return [...staticTreatments, ...(await listCustomTraitements(env))];
}

export async function addCustomPathologie(env, libelle, userId) {
  const text = String(libelle || '').trim();
  if (!text) throw new HttpError(400, 'Libellé requis');
  const target = normalize(text);
  const current = await allPathologies(env);
  const existing = current.find((p) => normalize(p.libelle || p.categorie) === target);
  if (existing) return { id: existing.id, libelle: existing.libelle, categorie: existing.categorie, existed: true };

  const existingIds = new Set(current.map((p) => p.id));
  const id = makeId('CUSTOM', text, existingIds);
  await sbInsert(
    env,
    'odonto_custom_pathologies',
    [{ id, libelle: text, categorie: CUSTOM_CATEGORIE, created_by: userId || null }],
    { returning: false }
  );
  return { id, libelle: text, categorie: CUSTOM_CATEGORIE, existed: false };
}

export async function addCustomTraitement(env, libelle, userId) {
  const text = String(libelle || '').trim();
  if (!text) throw new HttpError(400, 'Libellé requis');
  const target = normalize(text);
  const current = await allTreatments(env);
  const existing = current.find((t) => normalize(t.libelle) === target);
  if (existing) return { id: existing.id, libelle: existing.libelle, existed: true };

  const existingIds = new Set(current.map((t) => t.id));
  const id = makeId('CUSTOM', text, existingIds);
  await sbInsert(env, 'odonto_custom_traitements', [{ id, libelle: text, created_by: userId || null }], {
    returning: false,
  });
  return { id, libelle: text, existed: false };
}

export const STATIC_PATHOLOGIE_IDS = new Set(staticPathologies.map((p) => p.id));
export const STATIC_TRAITEMENT_IDS = new Set(staticTreatments.map((t) => t.id));

export async function customPathologieIds(env) {
  return new Set((await listCustomPathologies(env)).map((p) => p.id));
}
