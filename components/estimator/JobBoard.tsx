"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BOARD_STAGES,
  boardTiles,
  stageCounts,
  tileTitle,
  tileValue,
  type BoardDeal,
  type BoardEstimate,
  type BoardStage,
  type BoardTile,
} from "@/lib/estimator/jobBoard";

// The first screen: which job, before which assembly.
//
// The estimator opened straight into the tile grid, which assumes you already
// know what you are pricing. The question actually in front of somebody is the
// other one, and its answer lives in the Sales Board rather than in here.
//
// ONE TILE IS ONE DEAL. See jobBoard.ts for why that rather than one per
// property -- the short version is that a property with two live jobs would
// have to ask which after the tap.

/** ~0.45 m/px: a house, its yard and the neighbours. */
const TILE_Z = 18;
/**
 * Square, because the tiles are — and big enough to cover the largest of them
 * (`clamp(8rem, 15.2vw, 13rem)` is at most 208px), so the crop is always from
 * the middle outwards rather than leaving a gap at an edge.
 */
const MOSAIC = 320;

/**
 * A little slippy map with no Leaflet in it.
 *
 * The same Esri imagery the plan draws, addressed as plain tiles, positioned
 * so the property is at the CENTRE -- a yard on the edge of its own preview is
 * not a preview. Lazy, because a board of ninety would otherwise open a few
 * hundred requests at once.
 */
function MapPreview({ lat, lng }: { lat: number; lng: number }) {
  const tiles = useMemo(() => {
    const n = 2 ** TILE_Z;
    const r = (lat * Math.PI) / 180;
    const px = ((lng + 180) / 360) * n * 256;
    const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256;
    const left = px - MOSAIC / 2;
    const top = py - MOSAIC / 2;
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + MOSAIC - 1) / 256); ty++) {
      for (let tx = Math.floor(left / 256); tx <= Math.floor((left + MOSAIC - 1) / 256); tx++) {
        if (ty < 0 || ty >= n) continue;
        const wrapped = ((tx % n) + n) % n;   // the world wraps east-west
        out.push({
          key: `${tx},${ty}`,
          src: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${TILE_Z}/${ty}/${wrapped}`,
          x: tx * 256 - left,
          y: ty * 256 - top,
        });
      }
    }
    return out;
  }, [lat, lng]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute"
        style={{
          width: MOSAIC,
          height: MOSAIC,
          left: "50%",
          top: "50%",
          transform: `translate(${-MOSAIC / 2}px, ${-MOSAIC / 2}px)`,
        }}
      >
        {tiles.map((t) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={t.key}
            src={t.src}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute h-64 w-64 max-w-none"
            style={{ left: t.x, top: t.y }}
          />
        ))}
      </div>
    </div>
  );
}

const STAGE_TINT: Record<BoardStage, string> = {
  Propose: "#8b7fd4",
  Sent: "#4a9fd8",
  Sold: "#5a7a63",
  "Project Management": "#c9973f",
};

/**
 * What a job tile shows when there is no yard to show.
 *
 * The grid's own tiles fall back from a photograph to a centred glyph, and
 * this is the same fallback for the same reason: a tile with nothing in it
 * reads as broken, and a glyph reads as a tile whose picture has not arrived.
 */
const NO_MAP_GLYPH = "\u{1F3E1}";

export default function JobBoard({
  onOpen,
  onSkip,
  openClientId,
  openDealId,
  opening,
  notice,
}: {
  onOpen: (tile: BoardTile) => void;
  /** Leave the board without choosing — whatever was on screen is still there. */
  onSkip: () => void;
  /** The estimate currently loaded, so its tile can say so. */
  openClientId: string | null;
  /**
   * And the deal it is attached to.
   *
   * Both, because they answer at different moments. A job opened out of an
   * existing estimate is known by its client id; one STARTED from a tile has
   * no row on the board's estimate list yet -- that list was fetched once,
   * before it existed -- so without the deal id the board would show "no
   * estimate yet" on the very job you are sitting in.
   */
  openDealId: number | null;
  /** The deal being opened right now, so a slow read is not a dead tap. */
  opening: number | null;
  /** What went wrong opening one, said here rather than swallowed. */
  notice: string | null;
}) {
  const [deals, setDeals] = useState<BoardDeal[] | null>(null);
  const [estimates, setEstimates] = useState<BoardEstimate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<BoardStage[]>([]);

  useEffect(() => {
    let live = true;
    void fetch("/api/deals")
      .then((r) => r.json())
      .then((b: { ok?: boolean; deals?: BoardDeal[]; estimates?: BoardEstimate[]; error?: string }) => {
        if (!live) return;
        if (!b.ok) {
          setError(b.error ?? "The job list could not be read.");
          setDeals([]);
          return;
        }
        setDeals(b.deals ?? []);
        setEstimates(b.estimates ?? []);
      })
      .catch(() => {
        if (live) {
          setError("Could not reach the job list.");
          setDeals([]);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const counts = useMemo(() => stageCounts(deals ?? []), [deals]);
  const tiles = useMemo(
    () => boardTiles(deals ?? [], estimates, stages),
    [deals, estimates, stages],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        {BOARD_STAGES.map((s) => {
          const on = stages.length === 0 || stages.includes(s);
          return (
            <button
              key={s}
              onClick={() =>
                setStages((cur) =>
                  cur.includes(s) ? cur.filter((x) => x !== s)
                  // An empty filter means "all", so the first tap on a chip has
                  // to mean "only this one" rather than "all plus this one".
                  : cur.length === 0 ? [s] : [...cur, s],
                )
              }
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                on ? "text-black" : "bg-surface2 text-muted"
              }`}
              style={on ? { background: STAGE_TINT[s] } : undefined}
            >
              {s} <span className="opacity-70">{counts[s]}</span>
            </button>
          );
        })}
        {stages.length > 0 && (
          <button
            onClick={() => setStages([])}
            className="rounded-full bg-surface2 px-3 py-1 text-xs font-bold text-muted"
          >
            All
          </button>
        )}
        <button
          onClick={onSkip}
          className="ml-auto rounded-full bg-surface2 px-3 py-1 text-xs font-bold text-ink"
        >
          Skip to estimator
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto md-scroll px-3 pb-24">
        {notice && (
          <p className="mb-2 rounded-xl border border-edge bg-surface2 px-3 py-2 text-xs text-[#f59e0b]">
            {notice}
          </p>
        )}
        {deals === null ? (
          <p className="py-10 text-center text-sm text-muted">Looking…</p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-muted">{error}</p>
        ) : tiles.length === 0 ? (
          <p className="py-10 text-center text-sm leading-relaxed text-muted">
            Nothing on the board in {stages.length ? "those stages" : "Propose, Sent, Sold or Project Management"}.
          </p>
        ) : (
          /* The grid's own measurements, so a job tile and an assembly tile are
             the same size on the same screen. */
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(clamp(8rem, 15.2vw, 13rem), 1fr))",
              alignContent: "start",
            }}
          >
            {tiles.map((t) => {
              const located = t.deal.lat !== null && t.deal.lng !== null;
              const isOpen =
                (openDealId !== null && t.deal.id === openDealId) ||
                (t.estimate !== null && t.estimate.clientId === openClientId);
              const busy = opening === t.deal.id;
              return (
                <button
                  key={t.deal.id}
                  data-deal={t.deal.id}
                  onClick={() => onOpen(t)}
                  disabled={opening !== null}
                  title={t.deal.propertyAddress ?? undefined}
                  aria-label={
                    `${tileTitle(t.deal)} — ${t.stage}` +
                    (t.deal.propertyAddress ? `, ${t.deal.propertyAddress}` : "") +
                    (isOpen
                      ? ", open now"
                      : t.estimate
                        ? ", estimate started"
                        : ", no estimate yet")
                  }
                  aria-pressed={isOpen}
                  /*
                    The grid's tile, to the letter: square, rounded-3xl, no
                    border, its surface from the same token, and its picture
                    full-bleed under a scrim. A job tile and an assembly tile
                    sit in the same grid on the same screen, and two tile
                    shapes on one app reads as two apps.
                  */
                  className={`relative w-full aspect-square rounded-3xl flex flex-col overflow-hidden touch-none select-none ${
                    located ? "justify-end" : "items-center justify-center"
                  } ${opening !== null && !busy ? "opacity-40" : ""}`}
                  style={{
                    background: "var(--md-surface-2)",
                    // The ring the grid gives a chosen tile, in the accent
                    // rather than in white: this is not "on the job", it is
                    // THE job — the estimate currently loaded.
                    boxShadow: isOpen
                      ? "inset 0 0 0 2px var(--md-accent)"
                      : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                  }}
                >
                  {located ? (
                    <>
                      <MapPreview lat={t.deal.lat!} lng={t.deal.lng!} />
                      {/* A scrim, not a dimmer — the same one the grid uses,
                          so a caption stays readable over bright turf. */}
                      <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/5" />
                    </>
                  ) : (
                    <span
                      className="text-[clamp(1.75rem,4.5vw,3rem)] leading-none"
                      style={{ filter: "grayscale(1)", opacity: 0.75 }}
                      aria-hidden="true"
                    >
                      {NO_MAP_GLYPH}
                    </span>
                  )}

                  <span
                    /* Clamped, because a deal name is typed by a person and
                       the tile is 128px on a small screen. `overflow-hidden`
                       on the button would otherwise cut a line in half. */
                    className={`relative line-clamp-2 font-semibold leading-tight text-[clamp(0.7rem,1.35vw,0.95rem)] ${
                      located
                        ? "px-2.5 text-left text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
                        : "mt-2 px-2 text-center text-ink"
                    }`}
                  >
                    {tileTitle(t.deal)}
                  </span>

                  {/*
                    ONE sub-line, as the grid's tile has. The address is not on
                    it: on a located tile the picture IS the address, and what
                    the sub-line has to answer is what a tap does — open work
                    already done, or start it. The address is still on the
                    tile's title and its label for anyone who needs it, and it
                    leads when the deal has no name of its own.
                  */}
                  <span
                    className={`relative line-clamp-2 text-[clamp(0.6rem,1.1vw,0.78rem)] font-medium ${
                      located
                        ? "px-2.5 pb-2.5 text-left text-white/85 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
                        : "mt-1 px-2 text-center text-muted"
                    }`}
                  >
                    {busy
                      ? "Opening…"
                      : isOpen
                        ? "open now"
                        : [
                          // Why there is no picture — two different problems,
                          // and they get two different sentences. Only on a
                          // tile that has none: on a located one the picture
                          // is its own explanation.
                          located
                            ? null
                            : t.deal.propertyId === null
                              ? "not tied to a property"
                              : "no map location yet",
                          // What a tap does, which is the fact the sub-line
                          // exists for and is never dropped.
                          t.estimate
                            ? t.match === "property"
                              ? "estimate started — matched by property"
                              : "estimate started"
                            : "no estimate yet",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                  </span>

                  {/* Top right, white, tabular — the grid's badge, carrying the
                      number this tile has instead of a count. */}
                  {tileValue(t.deal.value) && (
                    <span className="absolute top-2.5 right-2.5 min-w-[1.6rem] px-1.5 py-0.5 rounded-full bg-white text-black text-[clamp(0.65rem,1.2vw,0.85rem)] font-bold tabular-nums text-center shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
                      {tileValue(t.deal.value)}
                    </span>
                  )}

                  {/* The same pill on the other corner, tinted rather than
                      white: a stage is a category, not a number. */}
                  <span
                    className="absolute top-2.5 left-2.5 px-1.5 py-0.5 rounded-full text-black text-[clamp(0.55rem,1vw,0.7rem)] font-bold shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
                    style={{ background: STAGE_TINT[t.stage] }}
                  >
                    {t.stage === "Project Management" ? "PM" : t.stage}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
