// Server-side Supabase access.
//
// These credentials never reach the browser: they are read from unprefixed env
// vars, so Next will not inline them into the client bundle. This module must
// only ever be imported from a route handler.

const URL_ENV = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface ServerConfig {
  url: string;
  key: string;
}

/**
 * Null when the deployment has not been given credentials yet, which is a
 * configuration problem worth reporting clearly rather than a 500.
 */
export function serverConfig(): ServerConfig | null {
  if (!URL_ENV || !SERVICE_KEY) return null;
  return { url: URL_ENV, key: SERVICE_KEY };
}

export function publicObjectUrl(
  cfg: ServerConfig,
  bucket: string,
  path: string,
): string {
  return `${cfg.url}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}

export async function rest(
  cfg: ServerConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function storageUpload(
  cfg: ServerConfig,
  bucket: string,
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<Response> {
  return fetch(`${cfg.url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": contentType,
      "x-upsert": "true",
    },
    body: body as unknown as BodyInit,
  });
}
