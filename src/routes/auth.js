'use strict';

import { HttpError, json, readJsonBody } from '../router.js';
import { verifyPassword, createSession, destroySession, extractToken, requireAuth } from '../auth.js';
import { sbSelect } from '../supabase.js';

export function register(router) {
  router.post('/api/auth/login', async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const { username, password } = body;
    if (!username || !password) throw new HttpError(400, 'Identifiant et mot de passe requis');

    const rows = await sbSelect(
      ctx.env,
      'odonto_users',
      `select=*&username=eq.${encodeURIComponent(String(username).trim())}`
    );
    const user = rows && rows[0];
    if (!user || !user.actif || !(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(401, 'Identifiants incorrects');
    }
    const { token, expiresAt } = await createSession(ctx.env, user.id);
    return json(200, {
      token,
      expiresAt,
      user: { id: user.id, nom: user.nom, prenom: user.prenom, username: user.username, role: user.role },
    });
  });

  router.post('/api/auth/logout', async (ctx) => {
    const token = extractToken(ctx.request);
    if (token) await destroySession(ctx.env, token);
    return json(200, { ok: true });
  });

  router.get('/api/auth/me', async (ctx) => {
    const user = await requireAuth(ctx);
    return json(200, { user });
  });
}
