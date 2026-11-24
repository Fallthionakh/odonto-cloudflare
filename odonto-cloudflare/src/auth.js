// Authentification maison, sans dépendance externe : hachage de mot de passe
// avec PBKDF2 (Web Crypto, disponible nativement dans le runtime Workers) et
// jetons de session opaques stockés dans la table odonto_sessions.
'use strict';

import { HttpError } from './router.js';
import { sbSelect, sbInsert, sbDelete } from './supabase.js';

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 heures
const PBKDF2_ITERATIONS = 100000;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    32 * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

function randomToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createSession(env, userId) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await sbInsert(env, 'odonto_sessions', [{ token, user_id: userId, expires_at: expiresAt }], { returning: false });
  return { token, expiresAt };
}

export async function destroySession(env, token) {
  if (!token) return;
  await sbDelete(env, 'odonto_sessions', `token=eq.${encodeURIComponent(token)}`);
}

export async function getUserFromToken(env, token) {
  if (!token) return null;
  const rows = await sbSelect(
    env,
    'odonto_sessions',
    `select=expires_at,odonto_users(id,nom,prenom,username,role,actif)&token=eq.${encodeURIComponent(token)}`
  );
  const session = rows && rows[0];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await destroySession(env, token);
    return null;
  }
  const user = session.odonto_users;
  if (!user || !user.actif) return null;
  return user;
}

export function extractToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export async function requireAuth(ctx) {
  const token = extractToken(ctx.request);
  const user = await getUserFromToken(ctx.env, token);
  if (!user) throw new HttpError(401, 'Authentification requise');
  ctx.user = user;
  ctx.token = token;
  return user;
}

export function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) {
    throw new HttpError(403, "Accès refusé : privilège insuffisant");
  }
}
