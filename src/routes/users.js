'use strict';

import { HttpError, json, readJsonBody } from '../router.js';
import { requireAuth, requireRole, hashPassword } from '../auth.js';
import { sbSelect, sbInsert, sbUpdate } from '../supabase.js';

const PUBLIC_FIELDS = 'id,nom,prenom,username,role,actif,created_at';

function publicUser(u) {
  if (!u) return u;
  const { password_hash, ...rest } = u;
  return rest;
}

export function register(router) {
  router.get('/api/users', async (ctx) => {
    const user = await requireAuth(ctx);
    requireRole(user, 'admin');
    const users = (await sbSelect(ctx.env, 'odonto_users', `select=${PUBLIC_FIELDS}&order=nom,prenom`)) || [];
    return json(200, { users });
  });

  router.post('/api/users', async (ctx) => {
    const admin = await requireAuth(ctx);
    requireRole(admin, 'admin');
    const body = await readJsonBody(ctx.request);
    const { nom, prenom, username, password, role } = body;
    if (!nom || !prenom || !username || !password || !role) {
      throw new HttpError(400, 'Tous les champs sont requis (nom, prénom, identifiant, mot de passe, rôle)');
    }
    if (!['admin', 'praticien'].includes(role)) throw new HttpError(400, 'Rôle invalide');
    if (String(password).length < 6) throw new HttpError(400, 'Le mot de passe doit contenir au moins 6 caractères');

    const existingRows = await sbSelect(
      ctx.env,
      'odonto_users',
      `select=id&username=eq.${encodeURIComponent(String(username).trim())}`
    );
    if (existingRows && existingRows.length) throw new HttpError(409, 'Cet identifiant est déjà utilisé');

    const passwordHash = await hashPassword(password);
    const created = await sbInsert(ctx.env, 'odonto_users', [
      {
        nom: nom.trim(),
        prenom: prenom.trim(),
        username: String(username).trim(),
        password_hash: passwordHash,
        role,
      },
    ]);

    return json(201, { user: publicUser(created && created[0]) });
  });

  router.put('/api/users/:id', async (ctx) => {
    const admin = await requireAuth(ctx);
    requireRole(admin, 'admin');
    const targetRows = await sbSelect(ctx.env, 'odonto_users', `select=*&id=eq.${encodeURIComponent(ctx.params.id)}`);
    const target = targetRows && targetRows[0];
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');

    const body = await readJsonBody(ctx.request);
    const nom = body.nom !== undefined ? body.nom : target.nom;
    const prenom = body.prenom !== undefined ? body.prenom : target.prenom;
    const role = body.role !== undefined ? body.role : target.role;
    const actif = body.actif !== undefined ? !!body.actif : target.actif;
    if (!['admin', 'praticien'].includes(role)) throw new HttpError(400, 'Rôle invalide');

    if (target.role === 'admin' && (role !== 'admin' || !actif)) {
      const otherAdmins =
        (await sbSelect(
          ctx.env,
          'odonto_users',
          `select=id&role=eq.admin&actif=eq.true&id=neq.${encodeURIComponent(target.id)}`
        )) || [];
      if (otherAdmins.length === 0) {
        throw new HttpError(400, 'Impossible : il doit rester au moins un compte administrateur actif');
      }
    }

    let passwordHash = target.password_hash;
    if (body.password) {
      if (String(body.password).length < 6) throw new HttpError(400, 'Le mot de passe doit contenir au moins 6 caractères');
      passwordHash = await hashPassword(body.password);
    }

    const updated = await sbUpdate(ctx.env, 'odonto_users', `id=eq.${encodeURIComponent(target.id)}`, {
      nom,
      prenom,
      role,
      actif,
      password_hash: passwordHash,
    });

    return json(200, { user: publicUser(updated && updated[0]) });
  });
}
