import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ASSEMBLY_MODELS, unitOfWorkLabel } from "@/lib/estimator/assemblies";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/estimator/visit";
import { configReport, rest, serverConfig } from "@/lib/server/supabase";

// Reading a site visit against the tile menu.
//
// The menu is the whole trick. `quick_tile_menu` was put in Supabase so that
// something other than the app could learn the vocabulary — the tap_key each
// tile commits, and the units one tap buys. Handing that to the model is what
// turns "about twenty yards of mulch" into three taps of `mat:mulch` instead
// of a number someone has to translate later.
//
// Nothing here writes to the estimate. It returns findings, each carrying the
// sentence it came from, and the iPad decides what to do with them. That is
// deliberate: a transcript records what was discussed, including the half of
// it that was ruled out, and a tap that nobody made is very hard to notice.

export const runtime = "nodejs";
/** The model reads a whole visit; the default 10s Vercel cap is not enough. */
export const maxDuration = 120;

const MODEL = "claude-opus-5";

interface MenuRow {
  tap_key: string | null;
  path: string | null;
  label: string | null;
  item_name: string | null;
  unit: string | null;
  units_per_tap: string | number | null;
  section: string | null;
  kind: string | null;
}

/** One line per tappable tile: what to say, and what one tap of it buys. */
function menuLines(rows: MenuRow[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of rows) {
    if (r.kind !== "item" || !r.tap_key) continue;
    // A generic and its variants share a tap_key only when the variant is
    // unpriced; keep every distinct key, drop exact repeats.
    const key = r.tap_key;
    const id = `${key}|${r.path ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const per = r.units_per_tap != null ? Number(r.units_per_tap) : 1;
    const unit = (r.unit ?? "").replace(/_/g, " ");
    lines.push(
      `${key} | ${r.path ?? r.label ?? key} | 1 tap = ${per} ${unit}`.trim(),
    );
  }
  return lines;
}

/** Assemblies price by the load too, so they get the same treatment. */
function assemblyLines(): string[] {
  return ASSEMBLY_MODELS.filter((m) => m.bucketSize).map(
    (m) =>
      `${m.id} | ${m.name} | 1 bucket = ${m.bucketSize} ${unitOfWorkLabel(
        m.unitOfWork,
      )} (one load of ${m.driver?.item.name ?? "material"})`,
  );
}

const FindingSchema = z.object({
  kind: z
    .enum(["match", "unpriced", "implied", "ambiguous", "note"])
    .describe(
      "match: named and a tile prices it. ambiguous: named but the quantity is too vague to commit. " +
        "implied: not said, but the named work usually needs it. " +
        "unpriced: named and nothing in the menu prices it. note: scope, access or site conditions.",
    ),
  label: z.string().describe("Short label for the row, e.g. 'Mulch' or 'Retaining wall'."),
  quote: z
    .string()
    .describe(
      "The sentence from the transcript this came from, quoted verbatim. Empty only for 'implied'.",
    ),
  detail: z
    .string()
    .describe(
      "One short sentence: why this count, or what is uncertain. Empty string if nothing to add.",
    ),
  commit_target: z
    .enum(["tap", "assembly", "none"])
    .describe("'tap' for a tile key, 'assembly' for an assembly id, 'none' for notes and unpriced items."),
  commit_key: z
    .string()
    .describe("The exact tap_key or assembly id from the menu. Empty string when commit_target is 'none'."),
  commit_count: z
    .number()
    .describe(
      "Whole number of taps or buckets, rounded UP to cover what was discussed. 0 when commit_target is 'none'.",
    ),
});

const ExtractionSchema = z.object({
  findings: z.array(FindingSchema),
});

const SYSTEM = `You read transcripts of landscape sales visits and turn them into estimate line items for Ricci's Landscape Management.

You are given a MENU of tappable tiles and assemblies. Each line is:
  key | where it lives | what one tap or bucket buys

Rules that matter:

1. Only ever use a key exactly as it appears in the MENU. Never invent one. If
   something was discussed and no menu line prices it, that is a finding of
   kind "unpriced" with commit_target "none" — that gap is the useful part.
2. Counts are whole taps or buckets, rounded UP. One tap of mulch is 8 cubic
   yards, so "about twenty yards" is 3 taps. Say the arithmetic in detail.
3. Quote the transcript verbatim in "quote". It is how the estimator checks
   you. Never paraphrase into the quote field.
4. Respect negation and conditionals. "We're not doing the patio this year"
   and "maybe the wall if the budget allows" are NOT matches. Skip the first
   entirely; the second is "ambiguous" or a "note", never a match.
5. Prefer an assembly over its parts when the work was described as a whole
   job ("mulch beds along the front"), and prefer plain taps when a material
   was named on its own ("drop two loads of topsoil").
6. "implied" is for what the named work normally needs and nobody mentioned —
   edging for a new bed, base under a patio. Suggest, never assume: these are
   prompts for the estimator, so keep them few and obvious.
7. "note" is for scope, access and site conditions with no price: gate widths,
   slope, drainage complaints, where the dog is, who the decision maker is.
8. If the transcript says nothing about landscaping work, return no findings
   rather than inventing some.

Be concise. One finding per real thing. Do not repeat the same item as both a
match and an implied item.`;

function bad(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Configuration check, so a 503 in the field is one request to diagnose. */
export async function GET() {
  return NextResponse.json({
    ...configReport(),
    model: MODEL,
    anthropicKey: process.env.ANTHROPIC_API_KEY ? "present" : "missing",
    maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
  });
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return bad(
      "This deployment has no ANTHROPIC_API_KEY. Add it to the project and redeploy — " +
        "the transcript is saved on the device either way.",
      503,
    );
  }
  const cfg = serverConfig();
  if (!cfg) {
    return bad(
      "This deployment has no Supabase credentials, so the tile menu cannot be read.",
      503,
      configReport(),
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Body was not JSON.");
  }

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) return bad("transcript is required.");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return bad(`Transcript is longer than ${MAX_TRANSCRIPT_CHARS} characters.`, 413);
  }

  const menuRes = await rest(
    cfg,
    "quick_tile_menu?select=tap_key,path,label,item_name,unit,units_per_tap,section,kind&order=ordering.asc",
  );
  if (!menuRes.ok) {
    return bad(`Could not read the tile menu: ${await menuRes.text()}`, 502);
  }
  const tiles = menuLines((await menuRes.json()) as MenuRow[]);
  if (tiles.length === 0) {
    return bad("The tile menu came back empty, so there is nothing to match against.", 502);
  }

  const menu = [
    "TILES (key | where it lives | what one tap buys)",
    ...tiles,
    "",
    "ASSEMBLIES (id | name | what one bucket buys)",
    ...assemblyLines(),
  ].join("\n");

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // The reading is the hard part: units to convert, negation to respect,
      // and a judgement about whether something was agreed or merely floated.
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `${menu}\n\n---\n\nTRANSCRIPT OF THE SITE VISIT:\n\n${transcript}`,
        },
      ],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
      // A landscaping transcript is not going to be declined, but a decline
      // would otherwise end as a bare stop with nothing to show the estimator.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return bad("The model declined to read that transcript.", 422);
    }
    const parsed = response.parsed_output;
    if (!parsed) return bad("The model's answer did not parse.", 502);

    // Keys are checked against the menu rather than trusted. A hallucinated
    // tap_key would tap an item the proposal then silently drops — the failure
    // is invisible, which makes it the one worth spending code on.
    const tapKeys = new Set(tiles.map((l) => l.split(" | ")[0]));
    const assemblyIds = new Set(ASSEMBLY_MODELS.map((m) => m.id));

    const findings = parsed.findings.map((f, i) => {
      const count = Math.max(0, Math.floor(f.commit_count));
      const known =
        f.commit_target === "tap"
          ? tapKeys.has(f.commit_key)
          : f.commit_target === "assembly"
            ? assemblyIds.has(f.commit_key)
            : false;
      const commit =
        known && count > 0
          ? {
              target: f.commit_target as "tap" | "assembly",
              key: f.commit_key,
              count,
            }
          : undefined;
      // A match that lost its key is not a match any more. Demoting it to
      // "unpriced" keeps the sentence in front of the estimator instead of
      // dropping the row and the fact with it.
      const kind = f.kind === "match" && !commit ? "unpriced" : f.kind;
      return {
        id: `vf-${Date.now().toString(36)}-${i}`,
        kind,
        label: f.label.trim() || "Unnamed",
        quote: f.quote ?? "",
        ...(f.detail ? { detail: f.detail } : {}),
        ...(commit ? { commit } : {}),
        status: "pending" as const,
      };
    });

    return NextResponse.json({ ok: true, findings, model: MODEL });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return bad("Rate limited by the API. Try again in a moment.", 429);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return bad("The ANTHROPIC_API_KEY on this deployment was rejected.", 502);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return bad("Could not reach the API. The transcript is still saved.", 504);
    }
    if (err instanceof Anthropic.APIError) {
      return bad(`The API returned ${err.status ?? "an error"}.`, 502);
    }
    return bad(err instanceof Error ? err.message : "Extraction failed.", 500);
  }
}
