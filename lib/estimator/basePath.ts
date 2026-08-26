// The app is served from /MasterDash/ on GitHub Pages and from / in dev, so
// anything fetched out of public/ has to know which. Next inlines the router's
// base path at build time; this reads it with a fallback for dev.
declare const process: { env: Record<string, string | undefined> };

export function basePath(): string {
  return process.env.__NEXT_ROUTER_BASEPATH ?? "";
}

export function publicUrl(path: string): string {
  return `${basePath()}${path.startsWith("/") ? path : `/${path}`}`;
}
