"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  flushPhotos,
  imageFromTransfer,
  photoTarget,
  photoUploadConfigured,
  removePhoto,
  setPhoto,
} from "@/lib/estimator/photos";
import type { CatalogItem, TileNode } from "@/lib/estimator/types";
import { selectionKey } from "@/lib/estimator/types";

/**
 * Per-tile options, opened by a single tap in Edit mode.
 *
 * Only the photo is here so far. The sheet exists as the place the rest will
 * hang off, so adding an option later is a section rather than a new surface.
 */
export default function TileOptionsSheet({
  node,
  item,
  photoUrl,
  onClose,
}: {
  node: TileNode;
  item: CatalogItem | null;
  /** What the tile shows now: a device photo, else the catalog one. */
  photoUrl: string | null;
  onClose: () => void;
}) {
  const key = node.commit ? selectionKey(node.commit) : node.id;
  const target = photoTarget(key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const accept = useCallback(
    async (file: Blob | null) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        await setPhoto(key, file);
        void flushPhotos();
      } catch {
        setError("That image could not be read. Try a JPEG or PNG.");
      } finally {
        setBusy(false);
      }
    },
    [key],
  );

  // A screenshot off the clipboard is the fastest way to get a supplier's
  // photo onto a tile, so ⌘V / ctrl-V works anywhere in the sheet.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromTransfer(e.clipboardData);
      if (file) {
        e.preventDefault();
        void accept(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const clip of items) {
        const type = clip.types.find((t) => t.startsWith("image/"));
        if (type) return void accept(await clip.getType(type));
      }
      setError("No image on the clipboard.");
    } catch {
      // Safari only allows this from a gesture it trusts, and denies it
      // outright without permission — the keyboard path always works.
      setError("Clipboard blocked by the browser — press ⌘V instead.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-3xl bg-surface border border-edge overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-edge">
          <span className="text-2xl" aria-hidden="true">
            {node.glyph}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-base font-bold text-ink truncate">
              {item?.name ?? node.label}
            </span>
            <span className="block text-xs text-muted">
              {target.kind} · {target.targetId}
            </span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bg-surface2 text-sm font-bold text-ink"
          >
            Done
          </button>
        </header>

        <div className="px-5 py-4">
          <h3 className="text-[0.7rem] font-bold tracking-widest text-muted mb-2">
            PHOTO
          </h3>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              void accept(imageFromTransfer(e.dataTransfer));
            }}
            onClick={() => fileInput.current?.click()}
            className={`relative rounded-2xl border-2 border-dashed overflow-hidden cursor-pointer transition-colors ${
              dropping ? "border-accent bg-accent/10" : "border-edge bg-surface2"
            }`}
            style={{ aspectRatio: "16 / 9" }}
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                <span className="text-3xl mb-2" aria-hidden="true">
                  📷
                </span>
                <span className="text-sm font-semibold text-ink">
                  Tap to choose or take a photo
                </span>
                <span className="text-xs text-muted mt-1">
                  or drag one in, or press ⌘V to paste
                </span>
              </span>
            )}
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold text-ink">
                Working…
              </span>
            )}
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void accept(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />

          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => fileInput.current?.click()}
              className="px-4 py-2 rounded-xl bg-surface2 text-sm font-semibold text-ink"
            >
              Choose photo
            </button>
            <button
              onClick={pasteFromClipboard}
              className="px-4 py-2 rounded-xl bg-surface2 text-sm font-semibold text-ink"
            >
              Paste
            </button>
            {photoUrl && (
              <button
                onClick={() => void removePhoto(key)}
                className="px-4 py-2 rounded-xl bg-surface2 text-sm font-semibold text-muted"
              >
                Remove
              </button>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-[#ef4444]">{error}</p>}

          <p className="mt-4 text-[0.68rem] text-muted leading-relaxed">
            The photo is saved on this iPad and shows on the tile straight away,
            with or without signal.{" "}
            {photoUploadConfigured()
              ? "It uploads to Supabase in the background."
              : "It will stay on this device until a Supabase upload path is configured — the project has no INSERT policy on storage today, so the browser cannot write images yet."}
          </p>
        </div>
      </div>
    </div>
  );
}
