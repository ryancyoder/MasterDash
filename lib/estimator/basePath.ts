// Anything fetched out of public/ has to know what subpath the app is served
// from. Next inlines the router's base path at build time; this reads it with
// a fallback for the usual case of a domain root.
declare const process: { env: Record<string, string | undefined> };

export function basePath(): string {
  return process.env.__NEXT_ROUTER_BASEPATH ?? "";
}

export function publicUrl(path: string): string {
  return `${basePath()}${path.startsWith("/") ? path : `/${path}`}`;
}
