import type { MetadataRoute } from "next";

// Required under `output: "export"` — metadata routes are dynamic by default,
// and a static export has nowhere to run them.
export const dynamic = "force-static";

// Relative start_url/scope so the manifest works under any basePath — GitHub
// Pages serves this app from /MasterDash/, not the domain root.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MasterDash",
    short_name: "MasterDash",
    description: "Tile-based personal operating system portal",
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
