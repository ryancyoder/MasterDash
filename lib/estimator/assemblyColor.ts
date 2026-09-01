// A designated colour per assembly, so a mulch bed is the same colour on every
// plan this crew draws.
//
// WHY IT IS RESOLVED AND NOT STORED, which is the decision the rest of this
// file follows from. A shape already carries a `color`, minted from the
// rotating palette at the moment it was drawn, and the obvious build is to
// overwrite that when the assembly is picked. It is the wrong one twice over:
// a bed drawn before the colour was chosen keeps the old one for ever, and
// changing your mind about what mulch looks like means walking every estimate
// on the device. Resolving at draw time means the setting reaches every bed
// that is already drawn, on every estimate, the moment it is set.
//
// It is the same rule as Upright's `elevationOf()` and this app's plant
// spreads: the fact is stored, the appearance is derived.
//
// The shape's own `color` stays, and stays load-bearing — it is what an
// unlinked shape ("Measure only") is drawn with, and what a linked one falls
// back to when its assembly has no colour designated. Nothing changes until
// somebody designates one, which is what makes this a setting rather than a
// re-theming.

/** Assembly id to hex. Only the assemblies actually designated are in it. */
export type AssemblyColors = Record<string, string>;

/**
 * The colours on offer, and they are not the tile palette.
 *
 * The palette a shape is minted from is eight bright hues chosen to tell
 * ADJACENT shapes apart — the right answer when the colour means nothing. A
 * designated colour means something, and what it usually means is the
 * material: mulch is brown, stone is grey, sod is green, and no amount of
 * teal will say so. So the material colours are here alongside the bright
 * ones, which stay for the beds that just need telling apart.
 *
 * Named because the name is what a person picks by — and what a test can
 * address without hard-coding a hex.
 */
export const SHAPE_PALETTE: { hex: string; name: string }[] = [
  { hex: "#84cc16", name: "Turf" },
  { hex: "#15803d", name: "Green" },
  { hex: "#92400e", name: "Mulch" },
  { hex: "#b45309", name: "Bark" },
  { hex: "#a8a29e", name: "Stone" },
  { hex: "#78716c", name: "Slate" },
  { hex: "#d6a15f", name: "Paver" },
  { hex: "#f59e0b", name: "Amber" },
  { hex: "#14b8a6", name: "Teal" },
  { hex: "#06b6d4", name: "Cyan" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#a855f7", name: "Violet" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#ef4444", name: "Red" },
];

/**
 * A colour made safe, or null.
 *
 * This comes out of localStorage, where an older build or a hand edit could
 * have left anything, and it is fed straight to a canvas `strokeStyle` — where
 * an unparseable value is not an error but a SILENT no-op that leaves the last
 * colour set, so one bad row would paint a bed in whatever was drawn before
 * it. Six or three hex digits, and nothing else.
 */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return null;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s;
}

/** Preferences read back from storage, rebuilt rather than cast. */
export function assemblyColorsFrom(value: unknown): AssemblyColors {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: AssemblyColors = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!id) continue;
    const hex = normaliseHex(raw);
    if (hex) out[id] = hex;
  }
  return out;
}

/**
 * What one shape is drawn in.
 *
 * The single answer, used by the map, by the cards and by the take-off
 * published for Upright — so a bed cannot be brown here and teal on the iPad.
 * A shape with no assembly, or one whose assembly has no colour designated,
 * keeps the palette colour it was minted with.
 */
export function shapeColorOf(
  shape: { color: string; assemblyId: string | null },
  colors?: AssemblyColors,
): string {
  if (!shape.assemblyId) return shape.color;
  return colors?.[shape.assemblyId] ?? shape.color;
}
