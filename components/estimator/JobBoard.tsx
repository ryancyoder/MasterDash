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
const MOSAIC_W = 320;
const MOSAIC_H = 240;

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
    const left = px - MOSAIC_W / 2;
    const top = py - MOSAIC_H / 2;
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + MOSAIC_H - 1) / 256); ty++) {
      for (let tx = Math.floor(left / 256); tx <= Math.floor((left + MOSAIC_W - 1) / 256); tx++) {
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
          width: MOSAIC_W,
          height: MOSAIC_H,
          left: "50%",
          top: "50%",
          transform: `translate(${-MOSAIC_W / 2}px, ${-MOSAIC_H / 2}px)`,
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

export default function JobBoard({
  onOpen,
  onSkip,
  openClientId,
  opening,
  notice,
}: {
  onOpen: (tile: BoardTile) => void;
  /** Leave the board without choosing — whatever was on screen is still there. */
  onSkip: () => void;
  /** The estimate currently loaded, so its tile can say so. */
  openClientId: string | null;
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
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {tiles.map((t) => (
              <button
                key={t.deal.id}
                onClick={() => onOpen(t)}
                disabled={opening !== null}
                className={`relative aspect-[4/3] overflow-hidden rounded-2xl border bg-surface text-left ${
                  t.estimate && t.estimate.clientId === openClientId
                    ? "border-accent"
                    : "border-edge"
                } ${opening !== null && opening !== t.deal.id ? "opacity-40" : ""}`}
              >
                {t.deal.lat !== null && t.deal.lng !== null ? (
                  <MapPreview lat={t.deal.lat} lng={t.deal.lng} />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-[0.65rem] text-muted">
                    {t.deal.propertyId === null
                      ? "Not tied to a property"
                      : "This property has no map location yet"}
                  </span>
                )}

                <span
                  className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[0.6rem] font-bold text-black"
                  style={{ background: STAGE_TINT[t.stage] }}
                >
                  {t.stage}
                </span>
                {tileValue(t.deal.value) && (
                  <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[0.6rem] font-bold text-white">
                    {tileValue(t.deal.value)}
                  </span>
                )}

                <span
                  className="absolute inset-x-0 bottom-0 px-2.5 py-2 text-white"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))" }}
                >
                  <span className="block text-xs font-bold leading-tight">{tileTitle(t.deal)}</span>
                  {t.deal.propertyAddress && t.deal.name && (
                    <span className="block text-[0.62rem] opacity-80">{t.deal.propertyAddress}</span>
                  )}
                  <span className="block text-[0.62rem] opacity-80">
                    {opening === t.deal.id
                      ? "Opening…"
                      : t.estimate
                        ? t.match === "property"
                          ? "estimate started — matched by property"
                          : "estimate started"
                        : "no estimate yet"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
