"use client";

/**
 * Link tiles.
 *
 * A leaf tile can carry a URL. Tapping it logs time as usual and opens the
 * link, so "start the Aspire timer and open Aspire" is one tap instead of two
 * actions in two apps.
 */

// Anything outside http/https is refused. A tile URL can arrive from an
// imported backup, so `javascript:` and `data:` must never reach window.open.
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Accepts what a person actually types — "aspire.com", "www.aspire.com/jobs",
 * or a full URL — and returns a canonical absolute URL, or null if it is not
 * something we are willing to open.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (!url.hostname.includes(".")) return null; // reject bare words
    return url.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Where to get a site's icon.
 *
 * Google's favicon service rather than `<host>/favicon.ico` because it
 * resolves the many ways a site declares its icon (apple-touch-icon, manifest,
 * <link rel>) and returns a usable size. The trade-off is that the request
 * tells Google which sites are on your board, and it needs a connection — so
 * the icon is cached locally at save time where the site's CORS policy allows
 * it, and every tile keeps its glyph as the offline fallback.
 */
export function faviconUrlFor(url: string, size = 128): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

/**
 * Try to inline a remote image as a data URL so the tile still has its icon
 * with no signal. Returns null when the host refuses cross-origin reads, in
 * which case the caller keeps the remote URL and the tile falls back to its
 * glyph offline.
 */
export async function cacheImageAsDataUrl(
  src: string,
  timeoutMs = 6000,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(src, { signal: controller.signal, mode: "cors" });
    clearTimeout(timer);
    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    // A favicon that big is not a favicon; refuse rather than bloat storage.
    if (blob.size > 64 * 1024) return null;

    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Open a tile's link.
 *
 * A synthesised anchor click rather than window.open, for two reasons.
 * `window.open(url, "_blank", "noopener")` returns null *by specification*
 * whether or not it succeeded, so its result cannot distinguish success from a
 * blocked popup — reading it as failure meant every successful tap raised a
 * "blocked" dialog. An anchor is also the path standalone PWAs handle most
 * reliably.
 *
 * Must be called synchronously from the tap handler: Safari only honours this
 * while a user gesture is still being processed.
 *
 * Returns false only when the URL is refused outright, which the caller should
 * surface — a stored `javascript:` link means an imported backup is unsafe.
 */
export function openUrl(raw: string): boolean {
  const url = normalizeUrl(raw);
  if (!url) return false;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  // Denies the opened page a handle back into this one via window.opener.
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
