// Endpoints pour l'import d'un registre Excel existant — même contrat que
// la version Node.js (odonto-app/src/routes/import.js) :
//   POST /api/import/preview  -> lit le fichier, suggère une correspondance
//                                 colonne -> champ, renvoie un aperçu (ne
//                                 modifie jamais la base).
//   POST /api/import/commit   -> rejoue le fichier avec le mapping confirmé
//                                 par l'utilisateur et crée/enrichit les
//                                 enregistrements, avec compte-rendu détaillé.
// Réservé aux administrateurs.
'use strict';

import { HttpError, json, readJsonBody } from '../router.js';
import { requireAuth, requireRole } from '../auth.js';
import { readXlsx } from '../utils/xlsx/xlsxReader.js';
import { suggestMapping, fieldCatalog } from '../utils/importMapping.js';
import { commitImport } from '../utils/importer.js';

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeUpload(body) {
  if (!body || !body.contentBase64) throw new HttpError(400, 'Fichier manquant (contentBase64 requis)');
  let bytes;
  try {
    bytes = base64ToBytes(body.contentBase64);
  } catch (e) {
    throw new HttpError(400, 'Fichier .xlsx invalide (encodage base64 incorrect)');
  }
  if (bytes.length === 0) throw new HttpError(400, 'Fichier vide');
  let parsed;
  try {
    parsed = readXlsx(bytes);
  } catch (e) {
    throw new HttpError(400, `Fichier .xlsx illisible : ${e.message}`);
  }
  if (!parsed.headers.length) throw new HttpError(400, 'Aucune ligne d’en-têtes trouvée dans le fichier');
  return parsed;
}

export function register(router) {
  router.post('/api/import/preview', async (ctx) => {
    const user = await requireAuth(ctx);
    requireRole(user, 'admin');
    const body = await readJsonBody(ctx.request);
    const { headers, rows } = decodeUpload(body);

    const mappingSuggestions = suggestMapping(headers);
    const catalog = fieldCatalog();

    return json(200, {
      headers,
      totalRows: rows.length,
      sampleRows: rows.slice(0, 10),
      mappingSuggestions,
      fieldCatalog: catalog,
    });
  });

  router.post('/api/import/commit', async (ctx) => {
    const user = await requireAuth(ctx);
    requireRole(user, 'admin');
    const body = await readJsonBody(ctx.request);
    const { headers, rows } = decodeUpload(body);

    const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
    if (!Object.values(mapping).some((v) => v && v !== 'ignore')) {
      throw new HttpError(400, 'Aucune correspondance de colonne confirmée — rien à importer');
    }

    const report = await commitImport(ctx.env, { headers, rows, mapping }, user.id);
    return json(201, { report });
  });
}
