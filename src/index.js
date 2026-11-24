// Point d'entrée du Worker Cloudflare. Gère uniquement les routes /api/* :
// les fichiers statiques (public/) sont servis directement par Cloudflare
// grâce à la configuration [assets] de wrangler.toml, sans passer par ce
// code.
'use strict';

import { Router, json } from './router.js';
import { register as registerAuth } from './routes/auth.js';
import { register as registerUsers } from './routes/users.js';
import { register as registerPatients } from './routes/patients.js';
import { register as registerConsultations } from './routes/consultations.js';
import { register as registerReference } from './routes/reference.js';
import { register as registerReports } from './routes/reports.js';
import { register as registerImport } from './routes/import.js';
import { register as registerManualReports } from './routes/manualReports.js';

const router = new Router();
registerAuth(router);
registerUsers(router);
registerPatients(router);
registerConsultations(router);
registerReference(router);
registerReports(router);
registerImport(router);
registerManualReports(router);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      // Ne devrait normalement pas être atteint : Cloudflare sert les
      // fichiers de public/ directement. Filet de sécurité au cas où.
      return new Response('Introuvable', { status: 404 });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error:
          "Configuration manquante : les secrets SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis sur le Worker (voir README.md).",
      });
    }

    const ctx = { request, env, url };
    const response = await router.handle(ctx, pathname);
    if (response) return response;
    return json(404, { error: 'Route API introuvable' });
  },
};
