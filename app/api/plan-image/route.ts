import { NextResponse } from "next/server";
import {
  configReport,
  publicObjectUrl,
  serverConfig,
  storageUpload,
} from "@/lib/server/supabase";

// The plan image's route to storage, server-side for the same reason as photos
// and estimates: every storage policy on the project is SELECT-only and the
// service role key can never ship to a client.
//
// Nothing here is on the critical path. The image is already in IndexedDB and
// already drawing by the time this is called — this only makes it reachable
// from another device. A failure is queued and retried, never surfaced as a
// blocked take-off.
//
// Same posture as /api/photos: the endpoint is public, so it validates hard
// rather than trusting the caller — a size cap, a real image signature, and
// ids constrained to what can appear in a storage path.

export const runtime = "nodejs";

const BUCKET = "estimate-plans";
const MAX_BYTES = 12 * 1024 * 1024;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

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

/** Configuration check, mirroring /api/photos — a 503 is miserable blind. */
export async function GET() {
  return NextResponse.json({ ...configReport(), bucket: BUCKET });
}

export async function POST(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This deployment has no Supabase credentials. Set them and redeploy.",
        ...configReport(),
      },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Body was not JSON.");
  }

  const { clientId, imageId, dataBase64 } = body;
  if (typeof clientId !== "string" || !ID.test(clientId)) {
    return bad("clientId is required and must be a plain id.");
  }
  if (typeof imageId !== "string" || !ID.test(imageId)) {
    return bad("imageId is required and must be a plain id.");
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

  const ext =
    contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  // Filed under the estimate that owns it, so the plans for one job stay
  // together and a re-picked image cannot overwrite another job's.
  const path = `${clientId}/${imageId}.${ext}`;

  const upload = await storageUpload(cfg, BUCKET, path, bytes, contentType);
  if (!upload.ok) {
    return bad(`Storage rejected the upload: ${await upload.text()}`, 502);
  }

  return NextResponse.json({
    ok: true,
    url: publicObjectUrl(cfg, BUCKET, path),
    path,
    bucket: BUCKET,
  });
}
