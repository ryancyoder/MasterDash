import { NextResponse } from "next/server";
import { configReport, publicObjectUrl, rest, serverConfig } from "@/lib/server/supabase";
import { BOARD_STAGES, type BoardDeal, type BoardEstimate } from "@/lib/estimator/jobBoard";

// The job board's data: live deals, where they are, and what has been priced.
//
// Read here rather than from the browser for the reason every read in this app
// is: `Sales Board` and `properties` are shared tables and the browser holds no
// credentials that can see them.
//
// THE PAIRING IS NOT DONE HERE. Deals and estimates come back as two lists and
// `jobBoard.ts` decides which estimate is which deal's -- that rule is a
// judgement about ambiguity rather than a query, and it is worth testing
// without a network. See estimateForDeal().

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DealRow {
  id: number;
  deal_name: string | null;
  stage: string;
  value: number | null;
  proposal_number: string | null;
  next_action: string | null;
  updated_at: string | null;
  created_at: string | null;
  board_order: number | null;
  property_id: number | null;
  properties: PropertyRow | PropertyRow[] | null;
}

interface PropertyRow {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Chosen by hand in the Sales Board; null on most properties. */
  cover_photo_id: number | null;
}

interface PhotoRow {
  id: number;
  storage_path: string;
  media_type: string;
  /** A video's still. `storage_path` on a video is the clip, not a picture. */
  poster_path: string | null;
}

interface EstimateRow {
  client_id: string;
  deal_id: number | null;
  property_id: number | null;
  job_name: string | null;
  updated_at: string | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "This deployment has no Supabase credentials.", ...configReport() },
      { status: 503 },
    );
  }

  // PostgREST wants the stage list quoted, and two of them carry a space.
  const stages = BOARD_STAGES.map((s) => `"${s}"`).join(",");
  const [dealsRes, estRes] = await Promise.all([
    rest(
      cfg,
      "Sales%20Board?select=id,deal_name,stage,value,proposal_number,next_action," +
        "updated_at,created_at,board_order,property_id," +
        "properties(address,latitude,longitude,cover_photo_id)" +
        `&stage=in.(${encodeURIComponent(stages)})&order=updated_at.desc&limit=300`,
    ),
    // Only what pairing needs. An estimate's lines are megabytes and the board
    // never shows one.
    rest(cfg, "quick_estimates?select=client_id,deal_id,property_id,job_name,updated_at&limit=500"),
  ]);

  if (!dealsRes.ok) {
    return NextResponse.json(
      { ok: false, error: `The deal list answered ${dealsRes.status}.` },
      { status: 502 },
    );
  }

  const rows = (await dealsRes.json()) as DealRow[];

  /*
    THE COVER PHOTOS, in a second read rather than a deeper embed.

    PostgREST can follow `properties.cover_photo_id` into `deal_photos`, but
    only by naming the foreign key constraint in the select — which puts a
    schema detail nobody can see from here into a string, and breaks silently
    if it is ever renamed. Two ids and one `in.()` is the same round trip and
    reads as what it is.

    It also fails independently: a photo read that does not answer leaves every
    tile on the board with its satellite and its caption, exactly as before
    this existed. Same rule as the estimate read below.
  */
  const coverIds = [
    ...new Set(
      rows
        .map((r) => one(r.properties)?.cover_photo_id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const covers = new Map<number, string>();
  if (coverIds.length) {
    const photoRes = await rest(
      cfg,
      `deal_photos?select=id,storage_path,media_type,poster_path&id=in.(${coverIds.join(",")})`,
    );
    if (photoRes.ok) {
      for (const ph of (await photoRes.json()) as PhotoRow[]) {
        // A video cover is its poster; the clip itself is not a picture, and
        // an <img> pointed at an mp4 is a broken tile.
        const path = ph.media_type === "video" ? ph.poster_path : ph.storage_path;
        if (path) covers.set(ph.id, publicObjectUrl(cfg, "deal-photos", path));
      }
    } else {
      console.warn("[deals] cover photos unavailable:", photoRes.status);
    }
  }

  const deals: BoardDeal[] = rows.map((r) => {
    const p = one(r.properties);
    return {
      id: r.id,
      name: r.deal_name,
      stage: r.stage,
      value: num(r.value),
      proposalNumber: r.proposal_number,
      nextAction: r.next_action,
      // A deal never touched since it was made still has a date.
      updatedAt: r.updated_at ?? r.created_at,
      boardOrder: typeof r.board_order === "number" ? r.board_order : null,
      propertyId: r.property_id,
      propertyAddress: p?.address ?? null,
      lat: num(p?.latitude),
      lng: num(p?.longitude),
      coverUrl:
        p?.cover_photo_id != null ? (covers.get(p.cover_photo_id) ?? null) : null,
    };
  });

  // A failed estimate read is not a failed board: every tile still opens, it
  // just cannot say which ones already have work behind them.
  let estimates: BoardEstimate[] = [];
  if (estRes.ok) {
    estimates = ((await estRes.json()) as EstimateRow[]).map((e) => ({
      clientId: e.client_id,
      dealId: e.deal_id,
      propertyId: e.property_id,
      jobName: e.job_name,
      updatedAt: e.updated_at,
    }));
  }

  return NextResponse.json({ ok: true, deals, estimates, estimatesOk: estRes.ok });
}

/**
 * Record a hand-arranged order for one stage.
 *
 * The whole stage's ids arrive in their new order and are written as dense
 * positions. See `reorderTiles()` for why the lot rather than the one that
 * moved: a drag says "this is my order now", and a column two apps read has to
 * be legible to both.
 *
 * One request per deal, because PostgREST has no bulk update by position and
 * the alternative is an RPC nobody else needs. 58 rows is the worst stage on
 * the board.
 */
export async function PATCH(request: Request) {
  const cfg = serverConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "No Supabase credentials." }, { status: 503 });
  }
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body was not JSON." }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : null;
  // Checked rather than trusted: this endpoint is public, and a bad id here
  // would write a position onto somebody else's deal.
  if (!ids || ids.length === 0 || ids.length > 300 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    return NextResponse.json({ ok: false, error: "A list of deal ids is required." }, { status: 400 });
  }

  const failed: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const res = await rest(cfg, `Sales%20Board?id=eq.${ids[i]}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ board_order: i }),
    });
    if (!res.ok) failed.push(ids[i]);
  }
  if (failed.length) {
    // Named rather than swallowed: half an order written is an order that will
    // read back wrong, and the screen has to be able to say so.
    return NextResponse.json(
      { ok: false, error: `${failed.length} of ${ids.length} could not be saved.`, failed },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
