// Client REST minimal pour Supabase (PostgREST), basé uniquement sur fetch().
// Utilise la clé service_role (secret du Worker) qui contourne le Row Level
// Security — c'est pour cela qu'il ne faut JAMAIS exposer cette clé côté
// navigateur : seul ce fichier, exécuté côté Worker, s'en sert.
'use strict';

function headers(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function parseResponse(res, label) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${label} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * GET sur une table/vue PostgREST.
 * @param {object} env
 * @param {string} table nom de la table (ex: 'odonto_patients')
 * @param {string} query chaîne de requête déjà encodée (ex: 'select=*&id=eq.3')
 */
export async function sbSelect(env, table, query = '') {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const res = await fetch(url, { headers: headers(env) });
  return parseResponse(res, `SELECT ${table}`);
}

export async function sbInsert(env, table, rows, { returning = true } = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(env, returning ? { Prefer: 'return=representation' } : { Prefer: 'return=minimal' }),
    body: JSON.stringify(rows),
  });
  return parseResponse(res, `INSERT ${table}`);
}

export async function sbUpdate(env, table, query, patch, { returning = true } = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers(env, returning ? { Prefer: 'return=representation' } : { Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  return parseResponse(res, `UPDATE ${table}`);
}

export async function sbDelete(env, table, query) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { method: 'DELETE', headers: headers(env, { Prefer: 'return=minimal' }) });
  return parseResponse(res, `DELETE ${table}`);
}

/** Échappe une valeur pour l'utiliser dans un filtre PostgREST `in.(...)`. */
export function pgIn(values) {
  return `(${values.map((v) => String(v).replace(/[(),]/g, '')).join(',')})`;
}
