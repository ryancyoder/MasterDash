import { NextResponse } from "next/server";
import { configReport, rest, serverConfig } from "@/lib/server/supabase";

// The estimate sync path, server-side for the same reason as photos: the
// browser has no write credentials, and the service role key cannot ship to
// it. Everything the tablet knows about Supabase, it learns through here.
//
// Two shapes of write land in one round trip. The row carries the estimate's
// scalars and its priced lines, upserted on `client_id` — minted on the iPad
// before the row has ever seen the network, so a save retried after a dropped
// connection updates one row rather than leaving three copies of a job. The
// ops carry the increments, inserted and never updated, so a push retried
// after the same dropped connection adds nothing twice.

export const runtime = "nodejs";

/** Enough to list jobs without dragging every line item across. */
const LIST_COLUMNS =
  "client_id,job_name,status,subtotal_cost,total_sell,updated_at,created_at";

export async function GET(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "No Supabase credentials.", ...configReport() },
      { status: 503 },
    );
  }

  const clientId = new URL(request.url).searchParams.get("client_id");

  // No id: the list behind the Open button.
  if (!clientId) {
    const res = await rest(
      cfg,
      `quick_estimates?select=${LIST_COLUMNS}&order=updated_at.desc&limit=50`,
    );
    if (!res.ok) return fail(res.status, await res.text());
    return NextResponse.json({ ok: true, estimates: await res.json() });
  }

  if (!isClientId(clientId)) {
    return NextResponse.json(
      { ok: false, error: "client_id is not a valid id." },
      { status: 400 },
    );
  }

  // One estimate, with the log it is projected from. Both in one response
  // because a row without its ops is a total nobody can safely add to.
  const [rowRes, opsRes] = await Promise.all([
    rest(cfg, `quick_estimates?client_id=eq.${clientId}&select=*&limit=1`),
    rest(
      cfg,
      `quick_estimate_taps?estimate_client_id=eq.${clientId}` +
        "&select=op_id,device,kind,selection_key,delta,label,at&order=at.asc",
    ),
  ]);
  if (!rowRes.ok) return fail(rowRes.status, await rowRes.text());
  if (!opsRes.ok) return fail(opsRes.status, await opsRes.text());

  const rows = (await rowRes.json()) as RowShape[];
  const ops = (await opsRes.json()) as OpRow[];
  return NextResponse.json({
    ok: true,
    estimate: rows[0] ? toClientRow(rows[0]) : null,
    ops: ops.map(toClientOp),
  });
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

  let body: { row?: Record<string, unknown>; ops?: ClientOp[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body was not JSON." },
      { status: 400 },
    );
  }

  const row = body.row;
  if (!row || typeof row.client_id !== "string" || !isClientId(row.client_id)) {
    return NextResponse.json(
      { ok: false, error: "row.client_id is required." },
      { status: 400 },
    );
  }
  const clientId = row.client_id;

  // Ops first. If the row write fails the increments are still recorded, and
  // the next push rebuilds the row from them; the other order can lose work.
  const ops = (Array.isArray(body.ops) ? body.ops : []).filter(isClientOp);
  if (ops.length > 0) {
    const res = await rest(
      cfg,
      "quick_estimate_taps?on_conflict=op_id",
      {
        method: "POST",
        // ignore-duplicates, not merge: an op is a fact about something that
        // already happened, so a re-push must never rewrite one.
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(
          ops.map((op) => ({
            op_id: op.id,
            estimate_client_id: clientId,
            device: op.device ?? null,
            kind: op.kind,
            selection_key: op.key,
            delta: Math.trunc(op.delta),
            label: op.label ?? null,
            at: op.at,
          })),
        ),
      },
    );
    if (!res.ok) {
      const detail = await res.text();
      console.error(`quick_estimate_taps insert failed: ${res.status} ${detail}`);
      return fail(502, detail);
    }
  }

  const res = await rest(cfg, "quick_estimates?on_conflict=client_id", {
    method: "POST",
    headers: {
      prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    // Logged as well as returned. A bare 502 in the Vercel logs says a save
    // failed and nothing about why, which is how an upsert that could never
    // have worked went unnoticed through every save the app had ever made.
    const detail = await res.text();
    console.error(`quick_estimates upsert failed: ${res.status} ${detail}`);
    return fail(502, detail);
  }

  const saved = (await res.json()) as RowShape[];
  return NextResponse.json({
    ok: true,
    acceptedOpIds: ops.map((op) => op.id),
    estimate: saved[0] ? toClientRow(saved[0]) : null,
  });
}

// --- shapes ---------------------------------------------------------------

interface RowShape {
  client_id: string;
  job_name?: string;
  deal_id?: number | null;
  property_id?: number | null;
  status?: string;
  total_sell?: number;
  subtotal_cost?: number;
  /** The projection blob. Carries the map take-off alongside the lines. */
  lines?: { plan?: unknown; visit?: unknown } | null;
  updated_at?: string;
}

interface OpRow {
  op_id: string;
  device: string | null;
  kind: string;
  selection_key: string;
  delta: number;
  label: string | null;
  at: string;
}

interface ClientOp {
  id: string;
  device?: string;
  kind: "tap" | "assembly";
  key: string;
  delta: number;
  label?: string;
  at: string;
}

function toClientRow(row: RowShape) {
  return {
    clientId: row.client_id,
    jobName: row.job_name ?? "",
    dealId: row.deal_id ?? null,
    propertyId: row.property_id ?? null,
    // Rides in the `lines` jsonb the row already has, so the map take-off
    // needs no column of its own. The client validates it shape by shape.
    plan: row.lines?.plan ?? null,
    visit: row.lines?.visit ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function toClientOp(op: OpRow) {
  return {
    id: op.op_id,
    device: op.device ?? "",
    kind: op.kind === "assembly" ? ("assembly" as const) : ("tap" as const),
    key: op.selection_key,
    delta: op.delta,
    ...(op.label ? { label: op.label } : {}),
    at: op.at,
  };
}

/**
 * Ids are minted by the device and go straight into a PostgREST filter, so
 * they are checked rather than trusted. crypto.randomUUID covers the normal
 * case; the seeded and fallback forms are why this is not a UUID test.
 */
function isClientId(v: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
}

function isClientOp(v: unknown): v is ClientOp {
  const o = v as ClientOp;
  return (
    !!o &&
    typeof o.id === "string" &&
    o.id.length > 0 &&
    o.id.length <= 200 &&
    (o.kind === "tap" || o.kind === "assembly") &&
    typeof o.key === "string" &&
    o.key.length > 0 &&
    o.key.length <= 200 &&
    typeof o.delta === "number" &&
    Number.isFinite(o.delta) &&
    typeof o.at === "string"
  );
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}
