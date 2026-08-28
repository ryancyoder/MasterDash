import type { MetadataRoute } from "next";

// Static: nothing here depends on the request, and a manifest that has to be
// rendered per request is a cold start in front of the app opening.
export const dynamic = "force-static";

// Relative start_url/scope so the manifest survives being served from a
// subpath rather than a domain root.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quick Estimator",
    short_name: "Estimator",
    description: "Tap a tile, price the job, on site and with no signal",
    start_url: ".",
    scope: ".",
    display: "standalone",
    orientation: "landscape",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "./icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
