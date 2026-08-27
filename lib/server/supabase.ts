// Server-side Supabase access.
//
// Credentials are read from unprefixed env vars so Next never inlines them
// into the client bundle. This module must only ever be imported from a route
// handler.
//
// Several names are accepted because Supabase itself has renamed these keys
// over time — `service_role` in the old dashboard, `sb_secret_...` in the new
// one — and projects end up with whichever was current when they were set up.
// Refusing to start over a name is a bad trade when the value is right there.

/** Names checked for the project URL, in order. */
const URL_NAMES = [
  "SUPABASE_URL",
  "SUPABASE_PROJECT_URL",
  // Not a secret, so the public variant is a fine source for the URL alone.
  "NEXT_PUBLIC_SUPABASE_URL",
];

/** Names checked for the service key, in order. */
const KEY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_KEY",
];

function firstPresent(names: string[]): { name: string; value: string } | null {
  for (const name of names) {
    // Indexed access rather than a literal, so nothing here can be statically
    // replaced at build time — these must resolve at runtime.
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      // Trailing slashes are trimmed because every use appends an absolute
      // path. A pasted "https://ref.supabase.co/" would otherwise build
      // "…co//storage/v1/…", which Supabase happens to tolerate but which
      // varies a request's identity — and so its cache key — for no reason.
      return { name, value: value.trim().replace(/\/+$/, "") };
    }
  }
  return null;
}

export interface ServerConfig {
  url: string;
  key: string;
  /** Which env var each value came from. Names only — never the values. */
  urlFrom: string;
  keyFrom: string;
}

/**
 * Null when the deployment has no credentials, which is a configuration
 * problem worth reporting precisely rather than a 500.
 */
export function serverConfig(): ServerConfig | null {
  const url = firstPresent(URL_NAMES);
  const key = firstPresent(KEY_NAMES);
  if (!url || !key) return null;
  return { url: url.value, key: key.value, urlFrom: url.name, keyFrom: key.name };
}

/**
 * What the deployment can see, for diagnosing a 503 without shipping secrets.
 * Reports variable NAMES and nothing else.
 */
export function configReport() {
  const url = firstPresent(URL_NAMES);
  const key = firstPresent(KEY_NAMES);
  return {
    configured: Boolean(url && key),
    urlFrom: url?.name ?? null,
    keyFrom: key?.name ?? null,
    lookedForUrl: URL_NAMES,
    lookedForKey: KEY_NAMES,
    // A service key behind a NEXT_PUBLIC_ name would be readable by every
    // visitor, so it is called out rather than quietly used.
    publicKeyMisconfiguration: Object.keys(process.env).some(
      (n) => n.startsWith("NEXT_PUBLIC_") && /SERVICE|SECRET/i.test(n),
    ),
  };
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
