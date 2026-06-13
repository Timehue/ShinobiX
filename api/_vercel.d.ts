// Local type shim for the Vercel-style handler request/response objects.
//
// Replaces the retired `@vercel/node` devDependency. The handlers are written
// Vercel-style (`export default async function handler(req, res)`) but run under
// Express (see server.ts), so these types only describe the structural shape the
// handlers rely on. They are byte-identical to @vercel/node's VercelRequest /
// VercelResponse. Every handler imports them with `import type`, so the import is
// erased at compile time — there is zero runtime dependency on this file (and it
// is a .d.ts, so it emits no JS into dist/).
//
// Dropping @vercel/node also removes its vulnerable transitive dependencies
// (undici, path-to-regexp, minimatch, smol-toml) from the dependency tree.

import type { IncomingMessage, ServerResponse } from 'node:http';

export type VercelRequestCookies = { [key: string]: string };
export type VercelRequestQuery = { [key: string]: string | string[] };
export type VercelRequestBody = any;

export type VercelRequest = IncomingMessage & {
  query: VercelRequestQuery;
  cookies: VercelRequestCookies;
  body: VercelRequestBody;
};

export type VercelResponse = ServerResponse & {
  send: (body: any) => VercelResponse;
  json: (jsonBody: any) => VercelResponse;
  status: (statusCode: number) => VercelResponse;
  redirect: (statusOrUrl: string | number, url?: string) => VercelResponse;
};
