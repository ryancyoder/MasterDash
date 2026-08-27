import { NextResponse } from "next/server";
import { configReport, rest, serverConfig } from "@/lib/server/supabase";

// The estimate save path, server-side for the same reason as photos: the
// browser has no write credentials, and the service role key cannot ship to it.
//
// Upserts on client_id, which the iPad mints before the row has ever seen the
// network, so a save retried after a dropped connection updates one row rather
// than leaving three copies of a job.

export const runtime = "nodejs";

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
    return NextResponse.json({ ok: false, error: "Body was not JSON." }, { status: 400 });
  }

  if (typeof body.client_id !== "string" || !body.client_id) {
    return NextResponse.json(
      { ok: false, error: "client_id is required." },
      { status: 400 },
    );
  }

  const res = await rest(cfg, "quick_estimates?on_conflict=client_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: await res.text() },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
