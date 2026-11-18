// Micro-routeur HTTP fait maison pour Cloudflare Workers (pas de dépendance
// type Express/itty-router). Même esprit que src/router.js de la version
// Node.js, mais basé sur l'API Fetch (Request/Response) native au runtime
// Workers plutôt que sur node:http.
'use strict';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function pathToRegex(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const { regex, paramNames } = pathToRegex(pattern);
    this.routes.push({ method, regex, paramNames, handler });
    return this;
  }

  get(pattern, h) { return this.add('GET', pattern, h); }
  post(pattern, h) { return this.add('POST', pattern, h); }
  put(pattern, h) { return this.add('PUT', pattern, h); }
  delete(pattern, h) { return this.add('DELETE', pattern, h); }

  // ctx = { request, env, url, user?, token? } — construit par l'appelant.
  async handle(ctx, pathname) {
    const candidates = this.routes.filter((r) => r.method === ctx.request.method);
    for (const route of candidates) {
      const match = route.regex.exec(pathname);
      if (!match) continue;
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      ctx.params = params;
      try {
        return await route.handler(ctx);
      } catch (err) {
        if (err instanceof HttpError) {
          return json(err.status, { error: err.message, details: err.details });
        }
        console.error(err);
        return json(500, { error: 'Erreur interne du serveur' });
      }
    }
    return null; // aucune route ne correspond
  }
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}
