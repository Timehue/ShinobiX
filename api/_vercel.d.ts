// Local type shim for the handler request/response objects.
//
// The api/ handlers keep the `export default async function handler(req, res)`
// shape they were first written in for Vercel (retired), but run under Express
// (see server.ts and server-api-routes.ts), so these types only describe the
// structural shape the handlers rely on. Every handler imports them with
// `import type`, so the import is erased at compile time — there is zero runtime
// dependency on this file (and it is a .d.ts, so it emits no JS into dist/).
// This file replaced the old `@vercel/node` devDependency, which also dropped
// its vulnerable transitive dependencies from the tree.
//
// NEW CODE: use the host-neutral names `ApiRequest` / `ApiResponse`.
//   import type { ApiRequest, ApiResponse } from '../_vercel.js';
// They are plain aliases of `VercelRequest` / `VercelResponse` (the same type,
// not a lookalike), so a handler using one name can pass req/res to a helper
// typed with the other. The Vercel* names stay because ~310 existing files
// import them; do not mass-rename them as a drive-by.

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

/** Host-neutral name for a handler's request. Prefer this in new code. */
export type ApiRequest = VercelRequest;
/** Host-neutral name for a handler's response. Prefer this in new code. */
export type ApiResponse = VercelResponse;
