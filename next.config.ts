import type { NextConfig } from "next";

// Deployed on Vercel rather than exported statically.
//
// The estimator needs a server: the browser has no Supabase write credentials
// (every storage policy on the project is SELECT-only) and the service role key
// can never ship to a client, so photo uploads and estimate saves go through
// this app's own route handlers. A static export has nowhere to run those.
//
// Everything else is unchanged — the app is still offline-first, still a PWA,
// and every page below is still statically rendered.
const nextConfig: NextConfig = {};

export default nextConfig;
