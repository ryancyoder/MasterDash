// The site visit: what was said, and what the app made of it.
//
// A transcript is talk, not a decision. Someone says "we'll probably do the
// patio, unless the wall eats the budget" and both of those are in the record
// even though only one of them might get built. So nothing here reaches the
// estimate on its own — extraction produces FINDINGS, each carrying the
// sentence it came from, and every one of them waits for a tap.
//
// The vocabulary the model matches against is `quick_tile_menu`, which exists
// for exactly this: it is the app's menu expressed as rows, with the tap_key
// each tile commits and the units one tap buys. That is what turns "about
// twenty yards of mulch" into three taps of `mat:mulch` rather than a guess.

/** What a finding is, which decides how it reads and whether it can commit. */
export type FindingKind =
  /** Named in the transcript and priced by a tile. */
  | "match"
  /** Named, and the catalog has nothing that prices it. */
  | "unpriced"
  /** Not said, but the work named implies it. */
  | "implied"
  /** A quantity too vague to commit without a decision. */
  | "ambiguous"
  /** Scope, access, site conditions. Worth keeping, never priced. */
  | "note";

export const FINDING_KINDS: FindingKind[] = [
  "match",
  "ambiguous",
  "implied",
  "unpriced",
  "note",
];

/**
 * What accepting a finding adds.
 *
 * `target` mirrors the op log's own two kinds, so accepting is one op and the
 * projection does the rest — a finding cannot introduce a third way for a
 * quantity to enter the estimate.
 */
export interface FindingCommit {
  target: "tap" | "assembly";
  /** A tap_key from the menu, or an assembly id. Validated server-side. */
  key: string;
  /** Taps, or buckets. Always a whole number of purchase increments. */
  count: number;
}

export interface VisitFinding {
  id: string;
  kind: FindingKind;
  /** How it reads in the list: "Mulch", "Retaining wall", "Gate is 36in". */
  label: string;
  /** The transcript sentence this came from. The reason to trust the row. */
  quote: string;
  /** The model's reading — why this count, what is uncertain. */
  detail?: string;
  /** Present when the row can be added. Absent on notes and unpriced items. */
  commit?: FindingCommit;
  status: "pending" | "accepted" | "dismissed";
}

export interface VisitState {
  /** What was pasted. The record of the visit, kept whether or not it parsed. */
  transcript: string;
  findings: VisitFinding[];
  /** When the findings were produced, so a stale read is visible as stale. */
  extractedAt: string | null;
  /** The transcript the findings were produced from, to spot an edit since. */
  extractedFrom: string | null;
}

export function emptyVisit(): VisitState {
  return { transcript: "", findings: [], extractedAt: null, extractedFrom: null };
}

/**
 * Long enough for an hour of talk, short enough that a paste accident does not
 * become a large bill. Roughly 25k tokens.
 */
export const MAX_TRANSCRIPT_CHARS = 100_000;

/** Findings are stale once the transcript has moved on from what produced them. */
export function findingsAreStale(visit: VisitState): boolean {
  return (
    visit.findings.length > 0 &&
    visit.extractedFrom !== null &&
    visit.extractedFrom !== visit.transcript
  );
}

export function pendingFindings(visit: VisitState): VisitFinding[] {
  return visit.findings.filter((f) => f.status === "pending");
}

/**
 * The badge on the tile: rows still waiting for a tap.
 *
 * Only findings that can actually be added count. A note about the gate width
 * and a wall the catalog cannot price are both worth keeping in front of the
 * estimator, but neither is answerable by tapping — counting them would leave
 * the badge stuck at a number that never goes down, which is exactly how a
 * checklist stops being read.
 */
export function visitPendingCount(visit: VisitState): number {
  return pendingFindings(visit).filter((f) => f.commit).length;
}

/** Named on the visit with nothing to price it — a standing reminder. */
export function unpricedCount(visit: VisitState): number {
  return visit.findings.filter(
    (f) => f.kind === "unpriced" && f.status !== "dismissed",
  ).length;
}

// --- Validation -----------------------------------------------------------
// The findings arrive from a model, over the network, and are then persisted
// and replayed. Every field is checked on the way in rather than trusted: a
// count that came back as a string would otherwise become NaN taps, and a
// finding with a commit key nothing recognises would tap an item that does not
// exist — which the proposal silently drops, making it the worst kind of bug.

function isKind(v: unknown): v is FindingKind {
  return typeof v === "string" && (FINDING_KINDS as string[]).includes(v);
}

export function findingFrom(value: unknown): VisitFinding | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (!isKind(v.kind)) return null;
  if (typeof v.label !== "string" || !v.label.trim()) return null;

  let commit: FindingCommit | undefined;
  const c = v.commit;
  if (c && typeof c === "object") {
    const cc = c as Record<string, unknown>;
    const count = typeof cc.count === "number" ? Math.floor(cc.count) : NaN;
    if (
      (cc.target === "tap" || cc.target === "assembly") &&
      typeof cc.key === "string" &&
      cc.key &&
      Number.isFinite(count) &&
      count > 0
    ) {
      commit = { target: cc.target, key: cc.key, count };
    }
  }

  const status =
    v.status === "accepted" || v.status === "dismissed" ? v.status : "pending";

  return {
    id: v.id,
    kind: v.kind,
    label: v.label.trim(),
    quote: typeof v.quote === "string" ? v.quote : "",
    ...(typeof v.detail === "string" && v.detail ? { detail: v.detail } : {}),
    ...(commit ? { commit } : {}),
    status,
  };
}

export function visitFrom(value: unknown): VisitState {
  if (!value || typeof value !== "object") return emptyVisit();
  const v = value as Record<string, unknown>;
  const findings = Array.isArray(v.findings)
    ? v.findings.map(findingFrom).filter((f): f is VisitFinding => f !== null)
    : [];
  return {
    transcript: typeof v.transcript === "string" ? v.transcript : "",
    findings,
    extractedAt: typeof v.extractedAt === "string" ? v.extractedAt : null,
    extractedFrom: typeof v.extractedFrom === "string" ? v.extractedFrom : null,
  };
}

// --- Presentation ---------------------------------------------------------

export const KIND_LABEL: Record<FindingKind, string> = {
  match: "On the grid",
  ambiguous: "Needs a number",
  implied: "Usually goes with it",
  unpriced: "Nothing prices this",
  note: "Worth knowing",
};

export const KIND_BLURB: Record<FindingKind, string> = {
  match: "Named on the visit and priced by a tile. Add what you agreed to.",
  ambiguous: "A quantity too vague to commit. The count is a proposal, not a reading.",
  implied: "Not said out loud, but the work named usually needs it.",
  unpriced: "Named on the visit with nothing in the catalog to price it. Quote it by hand.",
  note: "Scope, access and site conditions. Kept with the estimate, never priced.",
};

export const KIND_COLOR: Record<FindingKind, string> = {
  match: "#22c55e",
  ambiguous: "#f59e0b",
  implied: "#0ea5e9",
  unpriced: "#ef4444",
  note: "#78716c",
};
