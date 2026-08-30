"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_STAGES,
  boardPages,
  boardTiles,
  firstPageOf,
  gridFor,
  keepPage,
  reorderTiles,
  withOrder,
  stageCounts,
  tilePicture,
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
  /*
    ONE PAGE PER STAGE, AND NO SCROLLING ON ANY OF THEM.

    The filter chips are gone: with the stages as pages, filtering to one IS
    navigating to it, and two ways to say the same thing that can disagree is
    one too many. The stage row is still there and still counts, but a tap on
    it now jumps rather than filters.

    A busy stage runs to several pages inside its own run — see `boardPages()`
    for why that beats either scrolling or shrinking Sent's 58 tiles to
    postage stamps while Sold's 8 sit in an empty screen.
  */
  const [page, setPage] = useState(0);
  /*
    EDIT MODE: the tiles come loose and a drag rearranges them.

    A mode rather than a gesture on a live tile, for the reason the estimator's
    own grid gives: a tap on a job tile opens it, and a drag that could also
    open one is a drag nobody trusts. Inside the mode nothing opens, so a
    finger can be as clumsy as it likes.

    The order it writes is shared: it is a column on the deal, so VoiceData's
    Sales Board can sort by the same arrangement rather than each app keeping
    its own idea of it.
  */
  const [editing, setEditing] = useState(false);
  /** The tile being dragged, and where in the page it currently sits. */
  const [drag, setDrag] = useState<{ id: number; from: number; over: number } | null>(null);
  /** A local order applied before the write lands, so nothing springs back. */
  const [pending, setPending] = useState<number[] | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  /**
   * Deals whose cover photo would not load.
   *
   * Given the fire-and-forget world these photos come from, a row pointing at
   * an object that has moved is a real prospect — and a tile that goes black
   * is worse than one that never had a photograph.
   */
  const [brokenCovers, setBrokenCovers] = useState<Set<number>>(new Set());

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
  const tiles = useMemo(() => {
    const built = boardTiles(deals ?? [], estimates);
    // An order that has been dropped but not yet confirmed by the server. The
    // tile has to stay where it was put; springing back and then jumping
    // forward when the write lands reads as a drag that failed.
    return pending ? withOrder(built, pending) : built;
  }, [deals, estimates, pending]);

  /** The box the tiles have to fit in, measured rather than assumed. */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setBox({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // The grid's own tile size and gap, so a job tile is the size of an assembly
  // tile on the next screen. 12px is `gap-3`.
  const grid = useMemo(() => gridFor(box.width, box.height, 180, 12), [box]);
  const pages = useMemo(() => boardPages(tiles, grid.perPage), [tiles, grid.perPage]);

  /*
    Hold the page against a board that changes under it — a deal moves stage,
    the iPad is turned and the tiles per page with it. Kept during render
    rather than in an effect, so no frame ever draws a page that is not there.
  */
  const [held, setHeld] = useState<{ stage: BoardStage; index: number } | null>(null);
  const safePage = keepPage(pages, held, page);
  if (safePage !== page) setPage(safePage);
  const current = pages[safePage] ?? null;
  /*
    Where this page starts inside its own stage.

    A drop is an index within the PAGE, and the order is a position within the
    STAGE — so a tile dropped in the first slot of Sent's third page belongs at
    position 36, not at the front of Sent. Getting this wrong would silently
    move a tile to the top of the stage every time somebody rearranged a later
    page.
  */
  const pageStart = current ? (current.index - 1) * grid.perPage : 0;
  if (current && (held?.stage !== current.stage || held?.index !== current.index)) {
    setHeld({ stage: current.stage, index: current.index });
  }

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, next));
    setPage(clamped);
    const p = pages[clamped];
    if (p) setHeld({ stage: p.stage, index: p.index });
  };

  /*
    THE SWIPE.

    A pointer gesture rather than a scroll container: the brief is that no page
    scrolls, and a scroller that snaps is still a scroller — it can be left
    half way, it bounces at the ends, and on a tile grid it fights the taps.
    This commits on release, so a page either turns or it does not.

    `SWIPE_PX` is generous because the competing gesture is a tap on a tile,
    not a drag: anything short of a real sweep across the glass should still
    open the job under the thumb.
  */
  /**
   * Save an arrangement.
   *
   * On screen first: the order is applied locally and then written, so the
   * tile stays where the finger put it. A failure says so and puts the board
   * back — a private order that no other device will ever see is worse than
   * one that never moved, and this order is read by another app.
   */
  const saveOrder = async (ids: number[]) => {
    setPending(ids);
    setOrderError(null);
    try {
      const res = await fetch("/api/deals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Re-read rather than trusting the local copy: the write is what the
      // other app will sort by, so what comes back is what everyone sees.
      const fresh = await fetch("/api/deals").then((r) => r.json());
      if (fresh?.ok) {
        setDeals(fresh.deals ?? []);
        setEstimates(fresh.estimates ?? []);
      }
      setPending(null);
    } catch {
      setPending(null);
      setOrderError("That order could not be saved. Check the connection and try again.");
    }
  };

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_PX = 60;
  const onDown = (e: React.PointerEvent) => {
    // While arranging, a sideways sweep is a tile being moved. Turning the
    // page under it would drop it on a stage it did not come from.
    if (editing) return;
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: React.PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    // Mostly sideways, or it is a scroll gesture on a screen that does not
    // scroll and should do nothing rather than turn a page by accident.
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(safePage + (dx < 0 ? 1 : -1));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The stages, as navigation rather than as a filter: with a page per
          stage, filtering to one IS going to it. The count still says how big
          each part of the pipeline is, and the dots say how far across a stage
          this page sits. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2">
        {BOARD_STAGES.map((st) => {
          const here = current?.stage === st;
          return (
            <button
              key={st}
              onClick={() => go(firstPageOf(pages, st))}
              aria-pressed={here}
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                here ? "text-black" : "bg-surface2 text-muted"
              }`}
              style={here ? { background: STAGE_TINT[st] } : undefined}
            >
              {st} <span className="opacity-70">{counts[st]}</span>
            </button>
          );
        })}
        {current && current.ofStage > 1 && (
          <span className="flex items-center gap-1 pl-1" aria-hidden="true">
            {Array.from({ length: current.ofStage }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${
                  i + 1 === current.index ? "bg-ink" : "bg-surface2"
                }`}
              />
            ))}
          </span>
        )}
        <button
          onClick={() => {
            setEditing((v) => !v);
            setDrag(null);
            setOrderError(null);
          }}
          className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${
            editing ? "bg-accent text-black" : "bg-surface2 text-muted"
          }`}
        >
          {editing ? "Done" : "Arrange"}
        </button>
        <button
          onClick={onSkip}
          className="rounded-full bg-surface2 px-3 py-1 text-xs font-bold text-ink"
        >
          Skip to estimator
        </button>
      </div>

      {editing && (
        <p className="shrink-0 px-3 pb-1 text-[0.65rem] leading-tight text-muted">
          Drag a job to move it. The order is the deal&apos;s own, so it is the
          order the Sales Board sorts by too.
        </p>
      )}
      {orderError && (
        <p className="mx-3 mb-1 shrink-0 rounded-xl border border-edge bg-surface2 px-3 py-2 text-xs text-[#fca5a5]">
          {orderError}
        </p>
      )}

      {notice && (
        <p className="mx-3 mb-2 shrink-0 rounded-xl border border-edge bg-surface2 px-3 py-2 text-xs text-[#f59e0b]">
          {notice}
        </p>
      )}

      {/* NO SCROLL, anywhere. `overflow-hidden` is the guarantee on the
          container and `gridFor()` is the guarantee on what goes in it: the
          page holds exactly as many tiles as the measured box fits. */}
      <div
        ref={gridRef}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (swipe.current = null)}
        className="relative min-h-0 flex-1 overflow-hidden px-3 pb-3 touch-pan-y"
      >
        {deals === null ? (
          <p className="pt-10 text-center text-sm text-muted">Looking…</p>
        ) : error ? (
          <p className="pt-10 text-center text-sm text-muted">{error}</p>
        ) : current === null || current.tiles.length === 0 ? (
          <p className="pt-10 text-center text-sm leading-relaxed text-muted">
            {tiles.length === 0
              ? "Nothing on the board in Propose, Sent, Sold or Project Management."
              : `Nothing in ${current?.stage ?? "this stage"}. Swipe on for the rest of the pipeline.`}
          </p>
        ) : (
          /* The grid's own gap, and a tile size that makes whole rows fit —
             so a job tile is about the size of an assembly tile on the next
             screen, and the page never runs past its own bottom edge. */
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${grid.cols}, ${grid.size}px)`,
              gridAutoRows: `${grid.size}px`,
              alignContent: "start",
            }}
          >
            {current.tiles.map((t, i) => {
              // A photograph of the yard, then its roof from orbit, then a
              // glyph. tilePicture() owns the order; see jobBoard.ts.
              const picture = tilePicture(t.deal, brokenCovers.has(t.deal.id));
              const located = picture !== "none";
              const isOpen =
                (openDealId !== null && t.deal.id === openDealId) ||
                (t.estimate !== null && t.estimate.clientId === openClientId);
              const busy = opening === t.deal.id;
              return (
                <button
                  key={t.deal.id}
                  data-deal={t.deal.id}
                  data-index={i}
                  /* Nothing opens while arranging: a tap that could also be
                     the start of a drag is a tap nobody trusts. */
                  onClick={() => !editing && onOpen(t)}
                  disabled={opening !== null}
                  onPointerDown={
                    editing
                      ? (e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setDrag({ id: t.deal.id, from: i, over: i });
                        }
                      : undefined
                  }
                  onPointerMove={
                    editing && drag?.id === t.deal.id
                      ? (e) => {
                          // Which cell is under the finger. Read off the
                          // rendered tiles rather than computed from the grid
                          // maths, so a wrapped row or a resize cannot put the
                          // drop somewhere the eye disagrees with.
                          const over = document
                            .elementsFromPoint(e.clientX, e.clientY)
                            .map((el) => (el as HTMLElement).closest?.("[data-index]"))
                            .find(Boolean) as HTMLElement | undefined;
                          const at = over ? Number(over.dataset.index) : NaN;
                          if (Number.isInteger(at) && at !== drag.over) {
                            setDrag({ ...drag, over: at });
                          }
                        }
                      : undefined
                  }
                  onPointerUp={
                    editing
                      ? () => {
                          const d = drag;
                          setDrag(null);
                          // A tap in this mode is not a rearrangement. Saving
                          // on one would write the order the board already has
                          // — a network round trip, and a write to a column
                          // another app reads, for nothing.
                          if (!d || d.over === d.from) return;
                          const next = reorderTiles(tiles, d.id, pageStart + d.over);
                          if (next) void saveOrder(next.ids);
                        }
                      : undefined
                  }
                  onPointerCancel={editing ? () => setDrag(null) : undefined}
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
                  } ${opening !== null && !busy ? "opacity-40" : ""} ${
                    editing ? "qe-wiggle" : ""
                  } ${drag?.id === t.deal.id ? "opacity-60 ring-2 ring-accent" : ""}`}
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
                  {picture !== "none" ? (
                    <>
                      {picture === "photo" ? (
                        /* Full-bleed, cropped from the centre: the grid's own
                           treatment of a photographed tile, and a phone photo
                           of a house is never square. */
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={t.deal.coverUrl ?? ""}
                          alt=""
                          draggable={false}
                          loading="lazy"
                          decoding="async"
                          onError={() =>
                            setBrokenCovers((set) => {
                              if (set.has(t.deal.id)) return set;
                              const next = new Set(set);
                              next.add(t.deal.id);
                              return next;
                            })
                          }
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <MapPreview lat={t.deal.lat!} lng={t.deal.lng!} />
                      )}
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

                  {/* NO STAGE PILL. The page is the stage — its chip is lit in
                      the row above and every tile on the page shares it — so a
                      badge repeating it on all of them says nothing and spends
                      a corner of the picture doing it. It stays in the tile's
                      label, where a reader coming to one tile out of context
                      still gets it. */}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
