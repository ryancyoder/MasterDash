import { NextResponse } from "next/server";
import {
  publicObjectUrl,
  rest,
  serverConfig,
  storageUpload,
} from "@/lib/server/supabase";

// Where a tile photo taken on the iPad actually lands.
//
// The browser cannot write to Supabase — every storage policy on the project is
// SELECT-only, and the service role key can never ship to a client — so the
// upload is posted here and this route performs it with server credentials.
//
// This endpoint is public, so it validates hard rather than trusting the
// caller: a fixed set of kinds, a size cap, a real image signature, and an
// existence check against the catalog. The worst a stranger can do is replace
// a catalog photo, which is bounded and reversible; put the deployment behind
// Vercel's protection or Supabase Auth if that is not acceptable.

export const runtime = "nodejs";

/** Comfortably above a 1024 px JPEG, far below anything worth storing. */
const MAX_BYTES = 6 * 1024 * 1024;

const KINDS = ["material", "equipment", "service", "plant", "synthetic"] as const;
type Kind = (typeof KINDS)[number];

/** Which table proves the target is real. Others are app-local ids. */
const CATALOG_TABLE: Partial<Record<Kind, string>> = {
  material: "materials",
  equipment: "equipment",
  plant: "plants",
};

function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "image/png";
  if (
    bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return bad(
      "This deployment has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set.",
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Body was not JSON.");
  }

  const kind = body.kind as Kind;
  const targetId = body.targetId;
  const dataBase64 = body.dataBase64;

  if (!KINDS.includes(kind)) return bad(`Unknown kind: ${String(kind)}`);
  if (typeof targetId !== "string" || !targetId.trim()) {
    return bad("targetId is required.");
  }
  // Keeps the id out of the storage path's structure.
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(targetId)) {
    return bad("targetId has characters that are not allowed.");
  }
  if (typeof dataBase64 !== "string" || dataBase64.length === 0) {
    return bad("dataBase64 is required.");
  }

  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.byteLength === 0) return bad("Image data could not be decoded.");
  if (bytes.byteLength > MAX_BYTES) {
    return bad(`Image is larger than ${MAX_BYTES} bytes.`, 413);
  }
  const contentType = sniff(bytes);
  if (!contentType) return bad("That is not a JPEG, PNG or WebP.");

  // The target has to exist, so a typo cannot create an orphaned photo that
  // nothing will ever display.
  const table = CATALOG_TABLE[kind];
  if (table) {
    const check = await rest(cfg, `${table}?select=id&id=eq.${targetId}&limit=1`);
    if (!check.ok) return bad("Could not verify the target.", 502);
    if (((await check.json()) as unknown[]).length === 0) {
      return bad(`No ${kind} with id ${targetId}.`, 404);
    }
  }

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const stamp = Date.now();

  // Plants carry their own image column and their own bucket; everything else
  // goes through master_photos, which is the generic catalog photo table.
  const bucket = kind === "plant" ? "plant-images" : "master-photos";
  const path =
    kind === "plant"
      ? `plant-${targetId}-${stamp}.${ext}`
      : `${kind}/${targetId}/${stamp}.${ext}`;

  const upload = await storageUpload(cfg, bucket, path, bytes, contentType);
  if (!upload.ok) {
    return bad(`Storage rejected the upload: ${await upload.text()}`, 502);
  }

  const url = publicObjectUrl(cfg, bucket, path);

  if (kind === "plant") {
    const patch = await rest(cfg, `plants?id=eq.${targetId}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ image: url }),
    });
    if (!patch.ok) return bad(`Could not update the plant: ${await patch.text()}`, 502);
  } else {
    // One cover per entity: demote the old one before promoting this.
    await rest(
      cfg,
      `master_photos?entity_type=eq.${kind}&entity_id=eq.${targetId}&is_cover=is.true`,
      {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ is_cover: false }),
      },
    );
    const insert = await rest(cfg, "master_photos", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        entity_type: kind,
        entity_id: targetId,
        storage_path: path,
        is_cover: true,
      }),
    });
    if (!insert.ok) {
      return bad(`Could not record the photo: ${await insert.text()}`, 502);
    }
  }

  return NextResponse.json({ ok: true, url, path, bucket });
}
