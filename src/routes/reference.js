'use strict';

import { HttpError, json, readJsonBody } from '../router.js';
import { requireAuth } from '../auth.js';
import { AGE_GROUPS } from '../utils/ageGroups.js';
import indicateurs from '../data/indicateurs.js';
import { allPathologies, allTreatments, addCustomPathologie, addCustomTraitement } from '../utils/customReference.js';

export function register(router) {
  router.get('/api/reference', async (ctx) => {
    await requireAuth(ctx);
    return json(200, {
      pathologies: await allPathologies(ctx.env),
      treatments: await allTreatments(ctx.env),
      indicateurs,
      ageGroups: AGE_GROUPS,
    });
  });

  router.post('/api/reference/pathologies', async (ctx) => {
    const user = await requireAuth(ctx);
    const body = await readJsonBody(ctx.request);
    if (!body.libelle || !String(body.libelle).trim()) throw new HttpError(400, 'Libellé requis');
    const item = await addCustomPathologie(ctx.env, body.libelle, user.id);
    return json(201, { pathologie: item });
  });

  router.post('/api/reference/traitements', async (ctx) => {
    const user = await requireAuth(ctx);
    const body = await readJsonBody(ctx.request);
    if (!body.libelle || !String(body.libelle).trim()) throw new HttpError(400, 'Libellé requis');
    const item = await addCustomTraitement(ctx.env, body.libelle, user.id);
    return json(201, { traitement: item });
  });
}
