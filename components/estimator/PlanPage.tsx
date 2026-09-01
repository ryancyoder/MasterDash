"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlanCanvas, {
  type PhotoDot,
  type PlanCanvasApi,
  type CalloutDraw,
  type PlanTool,
  type SurveyLayer,
} from "@/components/estimator/PlanCanvas";
import {
  ReviewCard,
  ReviewColumn,
  ReviewFilmstrip,
  ReviewPhotoStage,
  ReviewTransport,
  ReviewVideo,
} from "@/components/estimator/ReviewPanel";
import { useReviewAudio } from "@/components/estimator/useReviewAudio";
import {
  driftScale,
  locatedPhotoAt,
  type GradeFrame,
  type ReviewSegment,
  type ReviewSession,
} from "@/lib/estimator/review";
import {
  fetchReviewSession,
  fetchReviewTranscript,
  movePoint,
} from "@/lib/estimator/reviewData";
import {
  ASSEMBLY_MODELS,
  getAssembly,
  takeoff,
  unitOfWorkLabel,
} from "@/lib/estimator/assemblies";
import { formatMoney, getItem, sellFor } from "@/lib/estimator/catalog";
import { PLANT_GROUPS } from "@/lib/estimator/tree";
import { loadPlants, plantsInGroup, type PlantRow } from "@/lib/estimator/plants";
import { spreadFtFor, stampFor } from "@/lib/estimator/plantStamp";
import {
  FALLBACK_CENTRE,
  parseFeet,
  scaleToKnownDimension,
  type Georef,
  type LatLng,
} from "@/lib/estimator/geo";
import { SURVEY_COLORS, elevationFeet } from "@/lib/estimator/survey";
import {
  ANCHOR_BLURB,
  anchorIsReal,
  layersNeedingUpload,
  mergeLayerRows,
  reorderLayers,
  visibleOverlays,
  type MapOverlay,
} from "@/lib/estimator/mapLayers";
import {
  assembliesForShape,
  bucketsForMeasurement,
  measurementOf,
  sharedNodeIds,
  surveyedCorners,
  workBought,
  CALLOUT_DEFAULT_W,
  CALLOUT_MAX_W,
  CALLOUT_MIN_W,
  calloutWidth,

  type PlacedPlant,
  type PendingPoint,
  type PlanNodes,
  type PlanShape,
  type ShapeKind,
} from "@/lib/estimator/plan";
import { heldPlanImages } from "@/lib/estimator/planImage";
import { shapesForPhoto, type ShapePhotoLink } from "@/lib/estimator/photoLink";
import {
  eventLabel,
  fetchPropertyPhotos,
  placeEventPhoto,
  type EventPhoto,
  type PhotoEvent,
} from "@/lib/estimator/propertyPhotos";
import { photoTakeoffLabel } from "@/lib/estimator/pendingTakeoff";
import {
  addOverlayFromFile,
  addOverlayFromUrl,
  uploadLayerImage,
  deleteLayer,
  fetchLayers,
  fetchProperties,
  fetchSurvey,
  fetchSurveySessions,
  localOverlayUrl,
  saveLayer,
  type PropertyOption,
  type UprightSurveySession,
} from "@/lib/estimator/propertyLayers";
import {
  addCallout,
  addPlant,
  addShape,
  attachProperty,
  detachShape,
  insertVertex,
  linkNodeToSurvey,
  mergeNodes,
  moveCallout,
  moveNodes,
  movePlant,
  linkPhotoToShape,
  removeCalloutFor,
  removePlant,
  setCalloutWidth,
  removePlantsOfKind,
  removeShape,
  setPlantVariant,
  redoPlan,
  undoPlan,
  setBasemap,
  setOverlayHidden,
  setPlanAnchor,
  setPlanView,
  setShapeSmooth,
  setReviewSession,
  setSurveySession,
  toggleVertexSmooth,
  unlinkPhotoFromShape,
  updateShape,
} from "@/lib/estimator/store";
import { useEstimate } from "@/lib/estimator/useEstimate";
import type { Estimate, EstimatorSettings } from "@/lib/estimator/types";

/**
 * The map take-off.
 *
 * A shape linked to an assembly commits ceil(measurement / bucketSize)
 * buckets, the same arithmetic as tapping that assembly's tile, so the two
 * ways of estimating land on one line in the proposal instead of two. The
 * overshoot is never hidden: every linked shape shows what it measured and
 * what those loads actually buy, because "1,200 measured, 1,560 bought" is a
 * decision to make rather than a rounding error to bury.
 *
 * What is new is underneath. This is a MAP now — the real ground, at the real
 * property, with the satellite as one layer and any number of georeferenced
 * plans over it. There is no scale to set, because the scale is the world's;
 * an area is a measurement the moment it is drawn.
 *
 * The overlays belong to the property rather than to this estimate, and are
 * shared with Upright. Aligning a plan against a yard is a fact about the
 * yard, it takes care to get right, and it should not have to be done twice
 * because somebody started a second quote.
 */

const TOOLS: { key: PlanTool; label: string; glyph: string }[] = [
  { key: "select", label: "Select", glyph: "☝︎" },
  { key: "area", label: "Area", glyph: "⬟" },
  { key: "linear", label: "Linear", glyph: "╱" },
  { key: "plant", label: "Plant", glyph: "🌳" },
];

const HINTS: Record<PlanTool, string> = {
  select: "Tap a shape to select it · drag its dots to reshape · + splits a side",
  area: "Tap each corner · tap the big green dot to close",
  linear: "Tap along the run · Finish when done",
  plant: "Tap to plant one · tap a symbol to pick it · Select to move it",
};

/**
 * "Draw this bed" — an assembly and the photographs of the thing.
 *
 * The photographs are attached to the shape the moment it is finished, which
 * is the whole point of arriving with one: the link that makes the take-off
 * carry its own evidence is made without anybody being asked to make it.
 */
export interface PlanDrawIntent {
  assemblyId: string;
  /** area or linear, from the assembly's own unit of work. */
  kind: ShapeKind;
  label: string;
  photos: ShapePhotoLink[];
}

export default function PlanPage({
  estimate,
  settings,
  intent,
  onIntentDone,
}: {
  estimate: Estimate;
  settings: EstimatorSettings;
  /**
   * A take-off somebody tagged in the field and came here to draw.
   *
   * Carried in rather than read from the plan, because it is not part of the
   * estimate — it is one navigation's worth of intent, and it dies the moment
   * the shape is drawn or the tool is changed.
   */
  intent?: PlanDrawIntent | null;
  onIntentDone?: () => void;
}) {
  const { plan } = estimate;
  /*
    The undo depths come from the store rather than from the estimate prop.

    They are not part of the document — a stack of past plans is this session's
    memory of what it did, not something the estimate carries — so they live on
    the snapshot beside it. Subscribing again here is free: it is the same
    external store the caller reads, so both see the same object.
  */
  const { undoDepth, redoDepth } = useEstimate();
  const [tool, setTool] = useState<PlanTool>("area");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMeasurements, setShowMeasurements] = useState(true);
  /**
   * Square corners up while drawing. On by default because beds and patios
   * are mostly rectangles; off because some yards are not, and a snap you
   * cannot turn off stops being a help.
   */
  const [rightAngle, setRightAngle] = useState(true);
  /** Round the corners of shapes drawn from here on. Off by default. */
  const [smoothNew, setSmoothNew] = useState(false);
  /**
   * The shape being drawn, owned here rather than in the canvas. The canvas
   * reports taps; Finish, Undo and Cancel are buttons on this page, and a
   * button needs something to act on.
   */
  const [pending, setPending] = useState<PendingPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Which assembly a newly drawn shape links to, per shape kind. */
  const [armed, setArmed] = useState<Record<ShapeKind, string | null>>({
    area: null,
    linear: null,
  });

  const [overlays, setOverlays] = useState<MapOverlay[]>([]);
  /** Object URLs for overlays this device holds the bytes for. */
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [survey, setSurvey] = useState<SurveyLayer | null>(null);
  /**
   * The side panel, on a phone.
   *
   * On an iPad in landscape it is a column beside the map and always open.
   * Below that it was simply `hidden`, which meant a phone had no property
   * picker — and since the drawing tools stay disabled until a property is
   * chosen, the whole screen was unusable rather than merely cramped.
   */
  const [panelOpen, setPanelOpen] = useState(false);
  const [pickingSurvey, setPickingSurvey] = useState(false);
  /** The layer the gestures are acting on, if any. */
  const [aligningId, setAligningId] = useState<string | null>(null);
  /** Marking a dimension: layer gestures off, taps collect the two ends. */
  const [scaling, setScaling] = useState(false);
  const [scalePoints, setScalePoints] = useState<LatLng[]>([]);
  const [scaleInput, setScaleInput] = useState("");
  const [scaleError, setScaleError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const anchor = plan.anchor;
  const propertyId = anchor?.propertyId ?? null;

  // The property's layers. Fetched, because they are shared — another device,
  // or Upright on site, may have placed one since this estimate was opened.
  //
  // The local half — whether THIS device holds the image bytes — is settled by
  // asking IndexedDB, not by remembering. See `mergeLayerRows()`: remembering
  // is what made a layer vanish the moment you left this view and came back.
  useEffect(() => {
    let live = true;
    void (async () => {
      // Nothing is set before the first await, including the empty case:
      // state moves once, when the answer is in.
      const rows = propertyId === null ? [] : await fetchLayers(propertyId);
      const held = await heldPlanImages(rows.map((r) => r.id));
      if (!live) return;
      if (propertyId === null) {
        setOverlays([]);
        return;
      }
      // A layer this device just added has bytes here and no row yet; the
      // fetch must not drop it.
      setOverlays((current) => mergeLayerRows(rows, current, held));
    })();
    return () => {
      live = false;
    };
  }, [propertyId]);

  /**
   * Push the bytes of any layer this device holds that Storage does not.
   *
   * The other half of the same bug: nothing ever uploaded a layer image, so
   * the picture lived in one iPad's IndexedDB and a second device listed a
   * layer it could never draw. Retried on every load rather than queued, so a
   * layer added with no signal lands the moment there is some, and a failed
   * upload fixes itself the next time the map is opened.
   *
   * Fire-and-forget, like every other write in this flow: the layer already
   * draws from the device's own copy, so a failure here costs nothing that is
   * on screen.
   */
  useEffect(() => {
    let live = true;
    const pending = layersNeedingUpload(overlays);
    if (pending.length === 0) return;
    void (async () => {
      for (const o of pending) {
        const saved = await uploadLayerImage(o);
        if (!live || !saved) continue;
        setOverlays((current) =>
          current.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
        );
      }
    })();
    return () => {
      live = false;
    };
    // Keyed on WHICH layers still need it, not on the array: the effect writes
    // to `overlays`, so depending on the array itself would re-run on its own
    // result and upload the same file for ever.
  }, [overlays.map((o) => (o.storagePath === null && o.imageId ? o.id : "")).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Object URLs for the local copies, minted once each and revoked together.
  useEffect(() => {
    let live = true;
    const minted: string[] = [];
    void Promise.all(
      overlays.map(async (o) => {
        if (!o.imageId) return null;
        const url = await localOverlayUrl(o);
        return url ? ([o.id, url] as const) : null;
      }),
    ).then((pairs) => {
      if (!live) {
        for (const p of pairs) if (p) URL.revokeObjectURL(p[1]);
        return;
      }
      const next: Record<string, string> = {};
      for (const p of pairs) {
        if (p) {
          next[p[0]] = p[1];
          minted.push(p[1]);
        }
      }
      setLocalUrls(next);
    });
    return () => {
      live = false;
      for (const url of minted) URL.revokeObjectURL(url);
    };
  }, [overlays]);

  // --- the visit being replayed -------------------------------------------
  //
  // The column toggles between this and the plan's own cards; the canvas below
  // is shared by both, which is the whole shape of the merged screen. Review
  // is chosen and loaded independently of the survey — see PlanState.review
  // for why the two are separate fields.
  const [mode, setMode] = useState<"plan" | "review">("plan");
  const [pickingReview, setPickingReview] = useState(false);
  const [visit, setVisit] = useState<ReviewSession | null>(null);
  const [segments, setSegments] = useState<ReviewSegment[]>([]);
  const [transcriptStatus, setTranscriptStatus] = useState("none");
  /**
   * What the filmstrip has picked, as `photo:<id>` or `grade:<id>`.
   *
   * One key rather than two pieces of state, because only one thing can be
   * picked: selecting a grade frame has to clear a photo pin and the reverse,
   * exactly as Upright's strip behaves. Two flags would eventually light both.
   */
  const [stripPick, setStripPick] = useState<string | null>(null);
  /*
    THE YARD'S OWN PHOTOGRAPHS.

    They started inside the filmstrip, which was right while the strip was the
    only thing that wanted them. Three things do now — the strip lists them,
    the canvas draws the ones with a position, and dropping one on the map
    writes that position — so they live here with the visit and the grade
    frames, and the strip is handed them.

    Still fetched lazily, on the first switch to them: most of the time nobody
    looks, and it is a request per estimate that would never be read.
  */
  const [stripSource, setStripSource] = useState<"visit" | "property">("visit");
  const [eventPhotos, setEventPhotos] = useState<PhotoEvent[] | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const estimatePropertyId = estimate.propertyId;

  useEffect(() => {
    if (stripSource !== "property" || estimatePropertyId === null) return;
    let live = true;
    void fetchPropertyPhotos(estimatePropertyId).then((r) => {
      if (!live) return;
      setEventPhotos(r.events);
      setPhotoError(r.error);
    });
    return () => {
      live = false;
    };
  }, [stripSource, estimatePropertyId]);

  // A change of yard invalidates what was fetched. Cleared during render, so
  // no frame ever shows another property's photographs under this one's name.
  const [lastPhotoProperty, setLastPhotoProperty] = useState(estimatePropertyId);
  if (lastPhotoProperty !== estimatePropertyId) {
    setLastPhotoProperty(estimatePropertyId);
    setEventPhotos(null);
    setPhotoError(null);
  }

  /**
   * The picture being dragged, and where the pointer is.
   *
   * ONE drag with two errands rather than two drags, because everything about
   * it except what the drop MEANS is identical — the threshold, the ghost, the
   * window listeners, the cancel. What differs is where it came from and
   * therefore what it is asking for:
   *
   *   "pin"     — a frame out of the filmstrip. Dropped on the map it gives a
   *               photograph a position; dropped on Add plan it becomes a
   *               georeferenced layer.
   *   "callout" — the selected picture out of the preview. Dropped on the map
   *               it holds that photograph open there, with a line back to its
   *               own dot.
   *
   * The preview can only be dragged for a photograph that HAS a dot, so a
   * call-out always has something to point at.
   */
  const [dragPhoto, setDragPhoto] = useState<
    | {
        kind: "pin";
        photo: EventPhoto;
        label: string;
        url: string;
        x: number;
        y: number;
        moved: boolean;
      }
    | {
        kind: "callout";
        photoId: string;
        label: string;
        url: string;
        x: number;
        y: number;
        moved: boolean;
      }
    | null
  >(null);
  const [selectedCalloutId, setSelectedCalloutId] = useState<string | null>(null);
  const canvasApi = useRef<PlanCanvasApi | null>(null);
  /*
    Which photo pin is lit.

    Both kinds answer here. A session pin is keyed `photo:<id>` and drawn under
    its bare id; an appointment photograph is drawn under `event:<id>`, which
    IS its strip key — so picking a frame lights its pin on the map, and
    dropping one lights the pin it just became. That feedback is the whole
    "connected to the map" half of the gesture: without it a drop is a write
    you have to take on trust.
  */
  const selectedPhotoId = stripPick?.startsWith("photo:")
    ? stripPick.slice("photo:".length)
    : stripPick?.startsWith("event:")
      ? stripPick
      : null;
  const selectedSurveyId = stripPick?.startsWith("grade:")
    ? stripPick.slice("grade:".length)
    : null;
  /** Which of the canvas and the clip is big. The other becomes a mini pane. */
  const [videoOnStage, setVideoOnStage] = useState(false);
  /**
   * The stage is showing the picked photograph rather than the map.
   *
   * Separate from `videoOnStage` and deliberately not folded into one
   * three-way: that one SWAPS the canvas and the clip, and this one covers
   * them both without moving either. One variable for two different operations
   * would have the swap's own button describing a state it does not own.
   */
  const [photoStage, setPhotoStage] = useState(false);
  /** A correction that did not save. Shown, never swallowed. */
  const [pinError, setPinError] = useState<string | null>(null);

  const reviewSessionId = plan.review?.sessionId ?? null;

  // Changing the visit invalidates everything loaded for the last one.
  // Adjusted during render rather than in an effect, so there is never a frame
  // showing one visit's transcript against another's photographs.
  const [lastVisitId, setLastVisitId] = useState(reviewSessionId);
  if (lastVisitId !== reviewSessionId) {
    setLastVisitId(reviewSessionId);
    setStripPick(null);
    setPinError(null);
    setVisit(null);
    setSegments([]);
    setTranscriptStatus("none");
  }

  useEffect(() => {
    if (!reviewSessionId) return;
    let live = true;
    void fetchReviewSession(reviewSessionId).then((s) => {
      if (live) setVisit(s);
    });
    void fetchReviewTranscript(reviewSessionId).then((t) => {
      if (!live) return;
      setSegments(t.segments);
      setTranscriptStatus(t.status);
    });
    return () => {
      live = false;
    };
  }, [reviewSessionId]);

  // Destructured rather than kept as one object: the hook hands back a ref
  // alongside plain values, and reading those off the object during render
  // reads as touching a ref.
  const {
    ref: audioRef,
    audioMs,
    durationSec,
    playing,
    toggle: toggleAudio,
    seekMs,
    gainError,
  } = useReviewAudio(visit?.audioUrl ?? null);
  /**
   * Wall-clock offsets onto the audio's clock.
   *
   * Derived from the file's real length against the session's wall length, so
   * it settles only once metadata has loaded — until then it is 1, which is
   * exactly the right answer for "we do not know yet".
   */
  const drift = useMemo(
    () => driftScale(visit?.wallMs ?? null, durationSec),
    [visit, durationSec],
  );

  /**
   * Photo pins for the canvas.
   *
   * Only the located ones: a pin with no fix cannot be drawn on the earth,
   * though it still belongs in the filmstrip, which is why the two lists are
   * built from the same photos but filtered differently.
   */
  const photoDots = useMemo<PhotoDot[] | null>(() => {
    const dots: PhotoDot[] = (visit?.photos ?? [])
      .filter((p) => p.lat !== null && p.lng !== null)
      .map((p) => ({
        kind: "session" as const,
        id: p.id,
        at: { lat: p.lat as number, lng: p.lng as number },
        seq: p.seq,
        headingDeg: p.headingDeg,
      }));

    /*
      The yard's own photographs, where they have a position.

      511 of the 705 on the project already carry one from the camera's EXIF;
      the other 194 are what dragging a frame onto the map is for. They are
      only drawn while the strip is showing them: a plan under a visit's own
      pins should not also sprout eighty pins from six months of appointments
      nobody asked to see.

      OUTLIERS ARE LEFT OFF. `is_outlier` is the flag for a fix that landed
      away from the site, so drawing them scatters pins across the county and
      pulls any fit with them. The strip still lists them, marked, and dropping
      one on the map is what settles it.
    */
    if (stripSource === "property") {
      for (const e of eventPhotos ?? []) {
        for (const ph of e.photos) {
          if (ph.lat === null || ph.lng === null || ph.isOutlier) continue;
          dots.push({
            kind: "event",
            id: `event:${ph.id}`,
            at: { lat: ph.lat, lng: ph.lng },
            seq: 0,
            headingDeg: null,
          });
        }
      }
    }
    return dots.length ? dots : null;
  }, [visit, stripSource, eventPhotos]);

  /** Every photograph of the yard, flat, for finding one by id. */
  const eventById = useMemo(() => {
    const m = new Map<string, { photo: EventPhoto; label: string }>();
    for (const e of eventPhotos ?? []) {
      for (const ph of e.photos) m.set(ph.id, { photo: ph, label: eventLabel(e) });
    }
    return m;
  }, [eventPhotos]);

  /**
   * Held-open photographs, resolved: the picture, and where its own dot is.
   *
   * Both looked up rather than stored, which is the rule everywhere here — a
   * pin corrected on the map moves the line's far end with it, and a caption
   * or a URL that had been copied into the call-out would go stale silently.
   *
   * A call-out whose dot is not currently drawn is not drawn either. That is
   * the honest answer rather than a limitation: the strip's source decides
   * which pins are on the map, and a picture on a line to nothing would be
   * claiming a position the map is not showing.
   */
  const calloutDraws = useMemo<CalloutDraw[]>(() => {
    if (!photoDots) return [];
    const dotById = new Map(photoDots.map((d) => [d.id, d.at]));
    const out: CalloutDraw[] = [];
    for (const callout of plan.callouts) {
      const dotAt = dotById.get(callout.photoId);
      if (!dotAt) continue;
      const url = callout.photoId.startsWith("event:")
        ? eventById.get(callout.photoId.slice("event:".length))?.photo.url
        : visit?.photos.find((p) => p.id === callout.photoId)?.url;
      if (!url) continue;
      out.push({
        id: callout.id,
        at: callout.at,
        dotAt,
        url,
        w: calloutWidth(callout.w),
      });
    }
    return out;
  }, [plan.callouts, photoDots, eventById, visit]);

  /** Whether the picked photograph is already held open, for the preview. */
  const pickedCalloutId = useMemo(() => {
    const photoId = selectedPhotoId;
    if (!photoId) return null;
    return plan.callouts.find((c) => c.photoId === photoId)?.id ?? null;
  }, [plan.callouts, selectedPhotoId]);

  /** The picked photograph's call-out width, for the card's slider. */
  const pickedCalloutWidth = useMemo(() => {
    const photoId = selectedPhotoId;
    if (!photoId) return CALLOUT_DEFAULT_W;
    return plan.callouts.find((c) => c.photoId === photoId)?.w ?? CALLOUT_DEFAULT_W;
  }, [plan.callouts, selectedPhotoId]);

  /** Whether it has a dot at all — a call-out needs something to point at. */
  const pickedHasDot = useMemo(
    () => Boolean(selectedPhotoId && photoDots?.some((d) => d.id === selectedPhotoId)),
    [selectedPhotoId, photoDots],
  );


  /**
   * The frames captured while shooting grade.
   *
   * THE VISIT'S OWN, when there is a visit. The strip is that session's record,
   * so its grade shots have to come from it — reading them off the survey layer
   * instead meant a replayed visit showed none of its own unless you had
   * separately picked the same session in the Survey card, which is two pickers
   * silently required to agree.
   *
   * The survey is the fallback rather than dead weight: most surveys on the
   * project belong to sessions with no audio, so they can never be replayed,
   * and their frames would otherwise have nowhere to appear at all.
   */
  const gradeFrames = useMemo<GradeFrame[]>(() => {
    if (visit) return visit.frames;
    return (survey?.points ?? [])
      .filter((p) => !p.hidden && p.photoUrl)
      .map((p) => ({
        id: p.id,
        url: p.photoUrl as string,
        kind: p.kind,
        label: p.label,
        capturedAt: p.capturedAt ?? null,
      }));
  }, [visit, survey]);

  /*
    DRAGGING A PHOTOGRAPH ONTO THE MAP.

    The pointer goes down on a filmstrip frame and comes up over the canvas —
    two components — so the page that holds both owns the gesture. Pointer
    events rather than HTML5 drag-and-drop, which does not exist on an iPad.

    It only becomes a drag once the finger has travelled `DRAG_START_PX`. Short
    of that it is a tap, and a tap on a frame picks it — the same distinction
    the tile grid draws between a press and a reorder, and for the same reason:
    a gloved tap on a moving truck is never perfectly still.
  */
  const DRAG_START_PX = 12;
  const dragStart = useRef<{ x: number; y: number; id: string } | null>(null);

  /*
    The drop handler reaches `addPhotoAsLayer` through a ref.

    That function is declared several hundred lines below — it needs
    `startAligning`, which needs the alignment state — and a closure here
    reaching forward to it is exactly what `react-hooks/immutability` catches:
    the effect would capture whichever version existed when it was created and
    stop seeing the current one. A ref kept up to date by its own effect always
    holds the latest, and nothing here runs before a pointer has been dragged.
  */
  const addAsLayerRef = useRef<(url: string, label: string) => void>(() => {});

  const beginPhotoDrag = useCallback(
    (photo: EventPhoto, event: PhotoEvent, e: React.PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY, id: photo.id };
      setDragPhoto({
        kind: "pin",
        photo,
        // The caption first: dropped on Add plan this becomes a layer's name,
        // and "Front bed" identifies a picture where "Appointment · Jun 2"
        // only identifies the visit it came from.
        label: photo.caption?.trim() || eventLabel(event),
        url: photo.url,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      });
    },
    [],
  );

  /** The preview, dragged out onto the map to hold that picture open there. */
  const beginCalloutDrag = useCallback(
    (photoId: string, url: string, label: string, e: React.PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY, id: photoId };
      setDragPhoto({
        kind: "callout",
        photoId,
        label,
        url,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      });
    },
    [],
  );

  /**
   * Put a photograph where it was dropped.
   *
   * On screen first, then written. The pin has to appear under the finger that
   * let it go — waiting on a round trip to draw it is the difference between a
   * gesture that worked and one that might have. A failed write says so and
   * puts the pin back where it was, because a pin that is only on this device
   * is worse than one that never moved.
   */
  const placePhoto = useCallback(
    async (photo: EventPhoto, at: { lat: number; lng: number }) => {
      const before = { lat: photo.lat, lng: photo.lng, isOutlier: photo.isOutlier };
      const patch = (next: Partial<EventPhoto>) =>
        setEventPhotos((groups) =>
          (groups ?? []).map((g) => ({
            ...g,
            photos: g.photos.map((p) => (p.id === photo.id ? { ...p, ...next } : p)),
          })),
        );
      // Placed by hand overrules the flag that says the camera's own fix
      // landed away from the site — see placeEventPhoto().
      patch({ lat: at.lat, lng: at.lng, isOutlier: false });
      setStripPick(`event:${photo.id}`);
      setPhotoError(null);
      const saved = await placeEventPhoto(photo.id, at);
      if (!saved) {
        patch(before);
        setPhotoError("That photograph could not be placed. Check the connection and try again.");
      }
    },
    [],
  );

  useEffect(() => {
    if (!dragPhoto) return;
    const move = (e: PointerEvent) => {
      const from = dragStart.current;
      if (!from) return;
      const far =
        Math.abs(e.clientX - from.x) > DRAG_START_PX ||
        Math.abs(e.clientY - from.y) > DRAG_START_PX;
      // A drag needs the map, so the photo viewer stands down the moment one
      // is recognised — dropping a pin onto a picture of the yard rather than
      // onto the yard would place it somewhere nobody could see, and the drop
      // would still succeed, which is the worst version of it. On `far` and
      // not on pointerdown: a plain TAP on a frame is how you leaf through the
      // strip at full size, and closing the viewer on that would fight the
      // whole point of it.
      if (far) setPhotoStage(false);
      setDragPhoto((d) => (d ? { ...d, x: e.clientX, y: e.clientY, moved: d.moved || far } : d));
    };
    const up = (e: PointerEvent) => {
      const from = dragStart.current;
      dragStart.current = null;
      const dragged =
        from !== null &&
        (Math.abs(e.clientX - from.x) > DRAG_START_PX ||
          Math.abs(e.clientY - from.y) > DRAG_START_PX);
      const drag = dragPhoto;
      setDragPhoto(null);
      if (!dragged) return;

      /*
        ADD PLAN IS A DROP TARGET.

        Checked before the map, and by asking the DOCUMENT what is under the
        pointer rather than by comparing rectangles: the button scrolls
        sideways in its own row, so a remembered rect is wrong the moment
        somebody has scrolled the tools — and it is a button, so `closest` is
        the whole test.

        A site photograph is often the only drawing that exists. Somebody
        photographs the customer's sketch on the tailgate, or an old survey
        taped to a garage wall, and until now getting that onto the map meant
        saving it out of the strip and re-importing it as a file.
      */
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (drag.kind === "pin" && under?.closest("[data-drop='add-plan']")) {
        addAsLayerRef.current(drag.url, drag.label);
        return;
      }

      // Off the canvas is a cancelled drag, not a pin under the side column.
      const at = canvasApi.current?.latLngAt(e.clientX, e.clientY) ?? null;
      if (!at) return;
      if (drag.kind === "callout") {
        // Selected by the CALL-OUT's id, which is what `selectedCalloutId`
        // means everywhere else — handing it a photograph's id left the new
        // frame drawn as though nothing were selected.
        setSelectedCalloutId(addCallout(drag.photoId, at));
        return;
      }
      placePhoto(drag.photo, at);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragPhoto?.url]);

  /** What the strip has picked, resolved to something the preview can show. */
  const pickedFrame = useMemo(() => {
    if (!stripPick) return null;
    if (stripPick.startsWith("event:")) {
      const found = eventById.get(stripPick.slice("event:".length));
      if (!found) return null;
      const caption = found.photo.caption?.trim();
      // The caption leads where somebody wrote one; otherwise the visit is
      // what identifies the picture.
      return {
        url: found.photo.url,
        title: caption || found.label,
        note: caption ? found.label : null,
      };
    }
    if (selectedSurveyId) {
      const f = gradeFrames.find((g) => g.id === selectedSurveyId);
      return f ? { url: f.url, title: f.label, note: "Grade shot" } : null;
    }
    const p = visit?.photos.find((x) => x.id === selectedPhotoId);
    if (!p) return null;
    // The tag leads where there is one: "Mulch Bed 2 · 1 of 3" says what the
    // picture is OF, and "Pin 7" only says where it sits in the roll. Rebuilt
    // from the rows rather than carried across, so it agrees with Upright's
    // own label by construction rather than by both sides remembering to.
    const tag = photoTakeoffLabel(p, visit!.photos);
    return {
      url: p.url,
      title: tag ?? `Pin ${p.seq}`,
      note: tag ? [p.note, `Pin ${p.seq}`].filter(Boolean).join(" · ") : p.note,
    };
  }, [stripPick, selectedSurveyId, selectedPhotoId, gradeFrames, visit, eventById]);

  /**
   * Attaching a photograph to the take-off it is a picture of.
   *
   * ARM, ONE TAP, DISARM — Upright's slope runs set that rule and it applies
   * for the same reason: the canvas tap that attaches is the same tap that
   * selects a shape, so a mode left open would attach a photograph to every
   * bed touched afterwards. It also clears when the photo changes, since the
   * armed tap belongs to the frame that armed it.
   */
  const [linkArmed, setLinkArmed] = useState(false);

  /** The pin the column is showing, when there is one that can be attached. */
  const linkablePhoto = useMemo(() => {
    if (!visit || selectedSurveyId) return null;
    const p = visit.photos.find((x) => x.id === selectedPhotoId);
    return p
      ? { sessionId: visit.id, photoId: p.id, url: p.url, label: `Pin ${p.seq}` }
      : null;
  }, [visit, selectedPhotoId, selectedSurveyId]);

  // Adjusted during render rather than in an effect: an armed tap belongs to
  // the frame that armed it, so changing photo must disarm BEFORE anything
  // reads the flag. React's documented way to reset state when an input
  // changes, and the same pattern useReviewAudio uses to reset the playhead.
  /*
    Arm the tool for an intent, once, when it arrives.

    Adjusted during render for the same reason the link arming is: the tool and
    the assembly have to be set BEFORE anything reads them, and an effect would
    render one frame with the intent present and the tool still on whatever it
    was. React's documented way to reset state when an input changes.
  */
  const intentKey = intent ? `${intent.assemblyId}:${intent.label}` : null;
  const [lastIntentKey, setLastIntentKey] = useState<string | null>(null);
  if (intentKey && lastIntentKey !== intentKey) {
    setLastIntentKey(intentKey);
    setTool(intent!.kind);
    setArmed((a) => ({ ...a, [intent!.kind]: intent!.assemblyId }));
    setPending([]);
  } else if (!intentKey && lastIntentKey !== null) {
    setLastIntentKey(null);
  }

  const armedFor = linkablePhoto?.photoId ?? null;
  const [lastArmedFor, setLastArmedFor] = useState(armedFor);
  if (lastArmedFor !== armedFor) {
    setLastArmedFor(armedFor);
    setLinkArmed(false);
  }

  const attachPhoto = useCallback(
    (shapeId: string) => {
      if (!linkablePhoto) return;
      linkPhotoToShape(shapeId, linkablePhoto);
      setLinkArmed(false);
      setSelectedId(shapeId);
    },
    [linkablePhoto],
  );

  /**
   * A shape's photographs, with the loaded visit's own rows preferred.
   *
   * The link copies a url down so a card can draw with no session loaded, but
   * Upright writes a NEW storage path whenever a picture is replaced — so a
   * copied url can point at a superseded file. Where the session IS loaded its
   * row is the truth; where it is not, the copy is all there is, and the card
   * says which by marking the ones it could not confirm.
   */
  const resolvePhotos = useCallback(
    (shape: PlanShape) =>
      (shape.photos ?? []).map((p) => {
        const live =
          visit && visit.id === p.sessionId
            ? visit.photos.find((x) => x.id === p.photoId)
            : undefined;
        return {
          photoId: p.photoId,
          url: live?.url ?? p.url,
          label: live ? `Pin ${live.seq}` : p.label,
          live: Boolean(live),
        };
      }),
    [visit],
  );

  /** Which take-offs the shown photograph documents — the link read back. */
  const photoDocuments = useMemo(() => {
    if (!linkablePhoto) return [];
    return shapesForPhoto(plan.shapes, linkablePhoto.photoId).map((sh) => ({
      id: sh.id,
      // Named by its assembly where it has one, and by its measurement where
      // it does not — a take-off with no assembly is still a real thing to
      // have photographed. Read directly rather than through labelFor(), which
      // is declared several hundred lines below this.
      label:
        (sh.assemblyId
          ? getAssembly(sh.assemblyId)?.name.replace(" – Standard", "")
          : null) ??
        `${Math.round(measurementOf(sh, plan.nodes)).toLocaleString()} ${
          sh.type === "area" ? "sq ft" : "ln ft"
        }`,
    }));
  }, [linkablePhoto, plan.shapes, plan.nodes]);

  const livePhotoId = useMemo(
    () =>
      visit
        ? (locatedPhotoAt(visit.photos, audioMs, drift)?.id ?? null)
        : null,
    [visit, audioMs, drift],
  );

  /**
   * A corrected pin, written back to Upright.
   *
   * Applied locally first so the pin stays where it was dropped rather than
   * springing back while the round trip runs — then reported if the write
   * fails, because a correction someone made deliberately and watched
   * disappear is worse than one that never appeared to save.
   */
  const handleMovePin = useCallback(
    (kind: "survey" | "photo", id: string, at: LatLng) => {
      setPinError(null);
      if (kind === "photo") {
        setVisit((s) =>
          s
            ? {
                ...s,
                photos: s.photos.map((p) =>
                  p.id === id ? { ...p, lat: at.lat, lng: at.lng } : p,
                ),
              }
            : s,
        );
      } else {
        setSurvey((cur) =>
          cur
            ? {
                ...cur,
                points: cur.points.map((p) => (p.id === id ? { ...p, at, placed: true } : p)),
              }
            : cur,
        );
      }
      void movePoint(kind, id, at).then((res) => {
        if (res.ok) return;
        setPinError(res.error);
        // Put it back: showing a pin where it is not is the failure this
        // whole path exists to avoid.
        const surveyId = plan.survey?.sessionId ?? null;
        if (kind === "survey" && surveyId) {
          void fetchSurvey(surveyId).then((r) => {
            if (r) setSurvey({ points: r.points, runs: r.runs } as SurveyLayer);
          });
        } else if (reviewSessionId) {
          void fetchReviewSession(reviewSessionId).then((s) => s && setVisit(s));
        }
      });
    },
    [reviewSessionId, plan.survey?.sessionId],
  );

  const surveySessionId = plan.survey?.sessionId ?? null;
  const surveyLabel = plan.survey?.label ?? null;
  useEffect(() => {
    let live = true;
    const load = surveySessionId ? fetchSurvey(surveySessionId) : Promise.resolve(null);
    void load.then((result) => {
      if (!live) return;
      const layer = result
        ? ({ points: result.points, runs: result.runs } as SurveyLayer)
        : null;
      setSurvey(layer);

      // A survey can anchor the map by itself.
      //
      // 47 of the 48 surveys on the project belong to a session with no
      // property, so requiring a property first meant anchoring on some
      // unrelated address and then pressing Fit to go and find the survey.
      // The points are real surveyed positions — a better fix on the ground
      // than half the property records, which have no coordinates at all —
      // so they stand in until a property is chosen, and never override one.
      if (!layer || anchorIsReal(plan.anchor)) return;
      const placed = layer.points.filter((p) => !p.hidden);
      if (placed.length === 0) return;
      const centre = placed.reduce(
        (acc, p) => ({
          lat: acc.lat + p.at.lat / placed.length,
          lng: acc.lng + p.at.lng / placed.length,
        }),
        { lat: 0, lng: 0 },
      );
      setPlanAnchor({
        propertyId: plan.anchor?.propertyId ?? null,
        // Deliberately not the survey's label: this anchors the MAP, it does
        // not name the yard. The estimate still wants a property, and the
        // card should keep saying so.
        label: null,
        centre,
        source: "upright",
      });
    });
    return () => {
      live = false;
    };
    // `plan.anchor` is read but deliberately not a dependency: this should run
    // when the SURVEY changes, not every time the anchor moves, or choosing a
    // property afterwards would re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveySessionId, surveyLabel]);

  /** Device copy first; the Storage URL is the fallback for a device that never held it. */
  const overlaySrc = useCallback(
    (o: MapOverlay) => localUrls[o.id] ?? o.imageUrl,
    [localUrls],
  );

  const drawnOverlays = useMemo(
    () => visibleOverlays(overlays, plan.hiddenOverlayIds),
    [overlays, plan.hiddenOverlayIds],
  );

  // Looked up rather than held, so a layer removed mid-alignment simply ends
  // the mode instead of leaving the canvas pointed at something gone.
  const aligning = useMemo(
    () => drawnOverlays.find((o) => o.id === aligningId) ?? null,
    [drawnOverlays, aligningId],
  );

  // A shape can vanish under the selection (deleted here, or an estimate
  // cleared elsewhere). Looking it up every render means a stale id is simply
  // no selection, with nothing to synchronise.
  const selected = plan.shapes.find((s) => s.id === selectedId) ?? null;

  const labelFor = useCallback((shape: PlanShape) => {
    if (!shape.assemblyId) return null;
    return getAssembly(shape.assemblyId)?.name.replace(" – Standard", "") ?? null;
  }, []);

  /**
   * Switching tools abandons a half-drawn shape rather than carrying it into a
   * tool that cannot finish it. Done on the way in, so nothing has to watch
   * for it afterwards.
   */
  const chooseTool = useCallback((next: PlanTool) => {
    setTool(next);
    setPending([]);
  }, []);

  /*
    THE PLANT TAKE-OFF.

    The third one, beside the area and the run, and the one that is COUNTED
    rather than measured: a bed is worth the square feet inside it, a run is
    worth its length, and a tree is worth one tree wherever it stands. So there
    is no pending state and no Finish — a tap is a whole plant.

    What it arms with is the SAME six categories the grid holds, and a tap
    commits the same `TileCommit` a tile does, which is what makes a shrub
    placed here and a shrub tapped there one line on the proposal instead of
    two. Defaulting to Shrub rather than to nothing: a plan is mostly shrubs,
    and a tool that refuses to do anything until you have made a choice you
    would have made anyway is a tool with a lock on it.
  */
  const [plantPick, setPlantPick] = useState<{
    itemId: string;
    variantId?: string;
    variantLabel?: string;
  }>({ itemId: "mat:shrub" });
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  /** The cultivar list, open on a category. Null is the categories alone. */
  const [namingGroup, setNamingGroup] = useState<string | null>(null);
  const [plantRows, setPlantRows] = useState<PlantRow[] | null>(null);

  /*
    962 rows, fetched the first time somebody opens the names and not before.

    Same reason the grid fetches them lazily: most estimates never drill that
    deep, and this is a page that has to open on a phone in a driveway. The
    categories work with nothing loaded, which is what makes the generic a
    real stopping point rather than a placeholder.
  */
  useEffect(() => {
    if (namingGroup === null || plantRows !== null) return;
    let live = true;
    void loadPlants().then((rows) => {
      if (live) setPlantRows(rows);
    });
    return () => {
      live = false;
    };
  }, [namingGroup, plantRows]);

  const plantGroupOf = useCallback(
    (itemId: string) => PLANT_GROUPS.find((g) => g.itemId === itemId) ?? null,
    [],
  );

  /**
   * The face a symbol is drawn with: its CATEGORY's stamp, colour and spread.
   *
   * Not the cultivar's own anything. A named boxwood is still a shrub, and a
   * plan that gave every cultivar its own mark would need a legend before it
   * could be read at all — so the line work is the category's, and so is the
   * 6ft it is drawn at. The colour is the catalog item's, so the map and the
   * tile agree without either being told to.
   */
  const plantFace = useCallback((plant: PlacedPlant) => {
    const item = getItem(plant.itemId);
    return {
      stamp: stampFor(plant.itemId),
      color: item?.color ?? "#22c55e",
      spreadFt: spreadFtFor(plant.itemId),
    };
  }, []);

  /** How a placed plant reads: the cultivar where there is one, else its kind. */
  const plantName = useCallback(
    (plant: PlacedPlant) =>
      plant.variantLabel?.trim() ||
      plantGroupOf(plant.itemId)?.label ||
      getItem(plant.itemId)?.tileName ||
      "Plant",
    [plantGroupOf],
  );

  const placePlant = useCallback(
    (at: LatLng) => {
      const id = addPlant(at, plantPick);
      // Selected on placement, so the card naming it is already open — which
      // is the whole reason a plant can be named after the fact rather than
      // only before.
      setSelectedPlantId(id);
    },
    [plantPick],
  );

  /**
   * What is on the plan, by species, newest kind last.
   *
   * The card list's counted twin of the shape list. Grouped, because twelve
   * separate rows saying "Shrub" is not something anybody can read, and the
   * number is the answer anyway: this is a bill of plants.
   */
  const plantKinds = useMemo(() => {
    const out: {
      key: string;
      itemId: string;
      variantId?: string;
      label: string;
      count: number;
    }[] = [];
    const byKey = new Map<string, number>();
    for (const plant of plan.plants) {
      const key = plant.variantId ? `${plant.itemId}::${plant.variantId}` : plant.itemId;
      const seen = byKey.get(key);
      if (seen === undefined) {
        byKey.set(key, out.length);
        out.push({
          key,
          itemId: plant.itemId,
          ...(plant.variantId ? { variantId: plant.variantId } : {}),
          label: plantName(plant),
          count: 1,
        });
      } else {
        out[seen].count += 1;
      }
    }
    return out;
  }, [plan.plants, plantName]);

  const selectedPlant = useMemo(
    () => plan.plants.find((p) => p.id === selectedPlantId) ?? null,
    [plan.plants, selectedPlantId],
  );

  const finish = useCallback(() => {
    if (tool !== "area" && tool !== "linear") return;
    if (pending.length < (tool === "area" ? 3 : 2)) return;
    const shapeId = addShape(tool, pending, armed[tool], smoothNew);
    // ARRIVING WITH AN INTENT MAKES THE LINK ITSELF. Somebody stood in the yard
    // and said what this is; being asked to attach the photographs again, here,
    // would be asking them to say it twice.
    if (intent && armed[tool] === intent.assemblyId) {
      for (const photo of intent.photos) linkPhotoToShape(shapeId, photo);
      onIntentDone?.();
    }
    setPending([]);
    setTool("select");
  }, [tool, pending, armed, smoothNew, intent, onIntentDone]);

  const patchOverlay = useCallback(
    (id: string, patch: Partial<MapOverlay>) => {
      setOverlays((current) => {
        const next = current.map((o) => (o.id === id ? { ...o, ...patch } : o));
        const changed = next.find((o) => o.id === id);
        // Fire-and-forget, like every other write in the tapping flow. What is
        // on screen has already moved; this is the copy the other devices get.
        if (changed) void saveLayer(changed);
        return next;
      });
    },
    [],
  );

  /**
   * Move a layer up or down the stack.
   *
   * Everything that changed is applied in ONE `setOverlays`, re-sorted, rather
   * than as a patch per row: the array on screen is what the canvas draws in
   * order, and patching one row at a time would leave it briefly holding two
   * layers claiming the same place. The writes are fire-and-forget after that,
   * like every other layer edit.
   */
  const moveLayer = useCallback((id: string, delta: 1 | -1) => {
    setOverlays((current) => {
      const moves = reorderLayers(current, id, delta);
      if (moves.length === 0) return current;
      const byId = new Map(moves.map((m) => [m.id, m.z]));
      const next = current
        .map((o) => (byId.has(o.id) ? { ...o, z: byId.get(o.id)! } : o))
        .sort((a, b) => a.z - b.z);
      for (const o of next) if (byId.has(o.id)) void saveLayer(o);
      return next;
    });
  }, []);

  const startAligning = useCallback((id: string) => {
    setAligningId(id);
    setScaling(false);
    setScalePoints([]);
    setScaleError(null);
    // A half-drawn bed would otherwise sit on screen through the whole of an
    // alignment and be finished against a plan that has since moved.
    setPending([]);
    setTool("select");
  }, []);

  const stopAligning = useCallback(() => {
    setAligningId(null);
    setScaling(false);
    setScalePoints([]);
    setScaleError(null);
  }, []);

  /**
   * Resize the layer so the two marked features are the stated distance apart.
   *
   * This is what turns a layer from "placed by eye" into the measurement, so
   * it sets `scaleLocked` — after which the pinch no longer resizes and the
   * Size slider is disabled. Nothing can change the scale by eye again;
   * Rescale re-runs the measurement.
   */
  const applyScale = useCallback(() => {
    if (!aligning) return;
    if (scalePoints.length < 2) {
      setScaleError("Tap both ends of the dimension first.");
      return;
    }
    const feet = parseFeet(scaleInput);
    if (feet === null || !(feet > 0)) {
      setScaleError("Try 100, 100' or 12'6\".");
      return;
    }
    const georef = scaleToKnownDimension(
      aligning.georef,
      scalePoints[0],
      scalePoints[1],
      feet,
    );
    if (!georef) {
      setScaleError("Those taps are too close — use the longest dimension you can.");
      return;
    }
    patchOverlay(aligning.id, { georef, scaleLocked: true });
    setScaling(false);
    setScalePoints([]);
    setScaleInput("");
    setScaleError(null);
  }, [aligning, scalePoints, scaleInput, patchOverlay]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || propertyId === null) return;
    setError(null);
    try {
      const centre = anchor?.centre ?? FALLBACK_CENTRE;
      const overlay = await addOverlayFromFile(
        propertyId,
        centre,
        file,
        overlays.length,
      );
      // On screen immediately, from IndexedDB. The row and the upload catch up.
      setOverlays((current) => [...current, overlay]);
      void saveLayer(overlay);
      // Straight into alignment: a layer arrives at a default size in the
      // middle of the view, which is never where it goes.
      startAligning(overlay.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That image could not be read.");
    }
  };

  /**
   * A photograph from the strip, dropped on Add plan, as a layer.
   *
   * Straight into alignment like any other import — a layer arrives at a
   * default size in the middle of the view, which is never where it goes, and
   * a photograph of a sketch is further from placed than a scanned plan is.
   */
  const addPhotoAsLayer = useCallback(
    async (url: string, label: string) => {
      if (propertyId === null) return;
      setError(null);
      try {
        const overlay = await addOverlayFromUrl(
          propertyId,
          anchor?.centre ?? FALLBACK_CENTRE,
          url,
          label,
          overlays.length,
        );
        setOverlays((current) => [...current, overlay]);
        void saveLayer(overlay);
        startAligning(overlay.id);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "That photograph could not be read.",
        );
      }
    },
    [propertyId, anchor, overlays.length, startAligning],
  );

  useEffect(() => {
    addAsLayerRef.current = (url, label) => void addPhotoAsLayer(url, label);
  }, [addPhotoAsLayer]);

  const drawing = tool === "area" || tool === "linear";
  const canFinish = pending.length >= (tool === "area" ? 3 : 2);
  const armable = useMemo(
    () => (drawing ? assembliesForShape(ASSEMBLY_MODELS, tool as ShapeKind) : []),
    [drawing, tool],
  );

  const ready = anchorIsReal(anchor);
  const shared = useMemo(() => sharedNodeIds(plan.shapes), [plan.shapes]);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Tools */}
      <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-2">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => chooseTool(t.key)}
            disabled={!ready || aligning !== null}
            className={`shrink-0 flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition-colors disabled:opacity-30 ${
              tool === t.key ? "bg-accent text-black" : "bg-surface2 text-ink"
            }`}
          >
            <span aria-hidden="true">{t.glyph}</span>
            {t.label}
          </button>
        ))}
        {/*
          UNDO, beside the tools rather than off at the end of the row.

          That row scrolls sideways on a phone, and the one control you reach
          for after a mistake must not be the one that has scrolled off. It
          sits next to what makes the mistakes.

          Two buttons, because an undo you cannot come back from is its own
          trap: pressed once too often it takes work with it and there is
          nothing to do about it. Redo is cleared by the next edit, which is
          the contract every other tool has taught everybody already.
        */}
        <button
          onClick={() => undoPlan()}
          disabled={undoDepth === 0}
          aria-label="Undo the last change to the plan"
          title="Undo the last change to the plan"
          className="shrink-0 rounded-xl bg-surface2 px-3 py-2 text-sm font-bold text-ink disabled:opacity-25"
        >
          ↶
        </button>
        <button
          onClick={() => redoPlan()}
          disabled={redoDepth === 0}
          aria-label="Redo the change just undone"
          title="Redo the change just undone"
          className="shrink-0 rounded-xl bg-surface2 px-3 py-2 text-sm font-bold text-ink disabled:opacity-25"
        >
          ↷
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setSmoothNew((v) => !v)}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold ${
            smoothNew ? "bg-accent text-black" : "bg-surface2 text-muted"
          }`}
          title={smoothNew ? "Curved edges: on" : "Curved edges: off"}
          aria-label="Curved edges"
        >
          ◠
        </button>
        <button
          onClick={() => setRightAngle((v) => !v)}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold ${
            rightAngle ? "bg-accent text-black" : "bg-surface2 text-muted"
          }`}
          title={rightAngle ? "Square corners: on" : "Square corners: off"}
          aria-label="Square corners"
        >
          ⊾
        </button>
        <button
          onClick={() => setShowMeasurements((v) => !v)}
          className="shrink-0 rounded-xl bg-surface2 px-3 py-2 text-xs font-bold text-muted"
          title={showMeasurements ? "Hide the numbers" : "Show the numbers"}
        >
          {showMeasurements ? "123" : "···"}
        </button>
        <button
          onClick={() => setBasemap(plan.basemap === "satellite" ? "none" : "satellite")}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold ${
            plan.basemap === "satellite" ? "bg-surface2 text-ink" : "bg-surface2 text-muted"
          }`}
          title="Show or hide the satellite"
        >
          {plan.basemap === "satellite" ? "🛰️" : "🛰️ off"}
        </button>
        {/*
          Add plan takes a FILE on a tap and a PHOTOGRAPH on a drop. The
          `data-drop` hook is what the drag's pointerup looks for with
          `elementFromPoint` — a rect remembered at drag start would be wrong
          the moment somebody scrolled this row sideways, which it does.

          It lights up while a frame is in flight, because a drop target
          nobody can see is a drop target nobody finds.
        */}
        <button
          data-drop="add-plan"
          onClick={() => fileRef.current?.click()}
          disabled={propertyId === null}
          title="Tap to import a drawing · drop a photograph here to place it as a layer"
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-30 ${
            dragPhoto?.kind === "pin" && dragPhoto.moved
              ? "bg-accent text-black"
              : "bg-surface2 text-muted"
          }`}
        >
          Add plan
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {error && (
        <p className="shrink-0 mb-2 rounded-xl bg-[#ef4444]/15 px-3 py-2 text-xs text-[#fca5a5]">
          {error}
        </p>
      )}

      {/*
        The assembly a shape will link to, armed BEFORE it is drawn. Picking
        after the fact is still possible on the shape card below, but arming
        first is the flow that matches the grid: choose the thing, then commit.
      */}
      {drawing && armable.length > 0 && (
        <div className="shrink-0 mb-2 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-[0.65rem] font-bold tracking-widest text-muted">
            BUYS
          </span>
          <button
            onClick={() => setArmed((a) => ({ ...a, [tool]: null }))}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
              armed[tool as ShapeKind] === null
                ? "bg-ink text-black"
                : "bg-surface2 text-muted"
            }`}
          >
            Measure only
          </button>
          {armable.map((m) => (
            <button
              key={m.id}
              onClick={() =>
                setArmed((a) => ({
                  ...a,
                  [tool]: a[tool as ShapeKind] === m.id ? null : m.id,
                }))
              }
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                armed[tool as ShapeKind] === m.id
                  ? "bg-accent text-black"
                  : "bg-surface2 text-ink"
              }`}
            >
              {m.name.replace(" – Standard", "")}
              <span className="ml-1.5 opacity-60 tabular-nums">
                {m.bucketSize!.toLocaleString()}/load
              </span>
            </button>
          ))}
        </div>
      )}

      {/*
        WHAT THE NEXT TAP PLANTS.

        The same row of six the grid holds, in the same order and wearing the
        same faces — this is the plan's half of one vocabulary, not a second
        list of plants that happens to look similar.

        "Name it" is the long press, made a button because there is no tile to
        press here. Tapping a category clears the cultivar with it: having
        picked Shrub, the next tap must plant a shrub, not the Green Velvet
        boxwood that was armed three categories ago.
      */}
      {tool === "plant" && (
        <div className="shrink-0 mb-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="shrink-0 text-[0.65rem] font-bold tracking-widest text-muted">
              PLANTS
            </span>
            {PLANT_GROUPS.map((g) => {
              const item = getItem(g.itemId);
              const on = plantPick.itemId === g.itemId;
              return (
                <button
                  key={g.itemId}
                  onClick={() => {
                    setPlantPick({ itemId: g.itemId });
                    setNamingGroup((open) => (open === null ? null : g.group));
                  }}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                    on ? "bg-accent text-black" : "bg-surface2 text-ink"
                  }`}
                >
                  <span aria-hidden="true" className="mr-1">
                    {item?.glyph ?? "🌿"}
                  </span>
                  {g.label}
                  {/*
                    The spread it will be drawn at, on the button that arms it.
                    A symbol on this plan is a canopy rather than a pin, so the
                    size is part of what you are choosing — and it is the one
                    number that decides whether eleven of them fit in the bed.
                  */}
                  <span className="ml-1 opacity-60 tabular-nums">
                    {spreadFtFor(g.itemId)}&#8242;
                  </span>
                </button>
              );
            })}
            <button
              onClick={() =>
                setNamingGroup((open) =>
                  open === null ? (plantGroupOf(plantPick.itemId)?.group ?? null) : null,
                )
              }
              aria-pressed={namingGroup !== null}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                namingGroup !== null ? "bg-ink text-black" : "bg-surface2 text-muted"
              }`}
            >
              {plantPick.variantLabel ?? "Name it"}
            </button>
          </div>

          {namingGroup !== null && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {/*
                The category's own generic leads the list, exactly as it does
                on the grid: an unnamed shrub is a real answer, and it has to
                be reachable from inside the naming row or choosing a cultivar
                would be a one-way door.
              */}
              <button
                onClick={() => setPlantPick({ itemId: plantPick.itemId })}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                  plantPick.variantId === undefined
                    ? "bg-accent text-black"
                    : "bg-surface2 text-muted"
                }`}
              >
                Any {plantGroupOf(plantPick.itemId)?.label ?? "plant"}
              </button>
              {plantRows === null ? (
                <span className="shrink-0 text-[0.7rem] text-muted">Loading names…</span>
              ) : (
                plantsInGroup(plantRows, namingGroup).map((row) => (
                  <button
                    key={row.id}
                    onClick={() =>
                      setPlantPick({
                        itemId: plantPick.itemId,
                        variantId: `plant:${row.id}`,
                        variantLabel: row.name,
                      })
                    }
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                      plantPick.variantId === `plant:${row.id}`
                        ? "bg-accent text-black"
                        : "bg-surface2 text-ink"
                    }`}
                  >
                    {row.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {aligning ? (
        <div className="shrink-0 mb-2 rounded-xl border border-accent bg-accent/10 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-ink">
              Placing {aligning.label}
            </span>
            <span className="min-w-0 flex-1 text-[0.7rem] text-muted">
              {scaling
                ? scalePoints.length < 2
                  ? "Tap both ends of a dimension the drawing states"
                  : "Now type what that dimension really is"
                : aligning.scaleLocked
                  ? "Drag to move · two fingers to turn — the size is locked to the dimension you set"
                  : "Drag to move · two fingers to pinch and turn"}
            </span>
            <button
              onClick={() => {
                setScaling((v) => !v);
                setScalePoints([]);
                setScaleError(null);
              }}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold ${
                scaling ? "bg-[#f59e0b] text-black" : "bg-surface2 text-ink"
              }`}
            >
              {scaling ? "Cancel" : aligning.scaleLocked ? "Rescale" : "Set scale"}
            </button>
            <button
              onClick={stopAligning}
              className="shrink-0 rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-black"
            >
              Done
            </button>
          </div>

          {scaling && scalePoints.length === 2 && (
            <div className="mt-2 flex items-center gap-2">
              <input
                autoFocus
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyScale()}
                placeholder={`100 · 100' · 12'6" · 30m`}
                className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-2 py-2 text-base text-ink"
              />
              <button
                onClick={applyScale}
                className="shrink-0 rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-bold text-black"
              >
                Set
              </button>
            </div>
          )}
          {scaleError && (
            <p className="mt-1 text-[0.7rem] text-[#fca5a5]">{scaleError}</p>
          )}
        </div>
      ) : (
        <p className="shrink-0 mb-2 text-[0.7rem] text-muted">
          {ready
          ? `${HINTS[tool]}${
              tool === "select"
                ? ""
                : smoothNew
                  ? " · edges curve"
                  : rightAngle
                    ? " · corners square up"
                    : ""
            }`
          : "Choose the property first — the map has to open somewhere."}
        </p>
      )}

      <div className="relative flex flex-1 min-h-0 gap-3">
        {/*
          The stage: the canvas and the clip, both mounted for the whole life
          of the screen, swapping which of them is big by CSS alone.

          Neither is ever unmounted or re-parented. A <video> put back into the
          tree restarts from zero on iOS Safari, and the canvas would lose its
          measured size and its view — so the swap moves geometry, not nodes.
          This is the same trick Upright's review uses for the same reason.
        */}
        <div className="relative flex-1 min-h-0">
        <div
          className={
            videoOnStage
              ? "absolute bottom-3 left-3 z-20 flex h-32 w-48 overflow-hidden rounded-xl border border-edge shadow-lg"
              : "absolute inset-0 flex"
          }
        >
        <PlanCanvas
          anchor={anchor}
          savedView={plan.view}
          onSaveView={setPlanView}
          basemap={plan.basemap}
          overlays={drawnOverlays}
          overlaySrc={overlaySrc}
          nodes={plan.nodes}
          shapes={plan.shapes}
          survey={survey}
          surveySessionId={surveySessionId}
          apiRef={canvasApi}
          photos={photoDots}
          livePhotoId={livePhotoId}
          selectedPhotoId={selectedPhotoId}
          onSelectPhoto={(id) =>
            // An appointment photograph's dot is already keyed with its
            // source; a session pin is a bare id and needs its prefix.
            setStripPick(id ? (id.startsWith("event:") ? id : `photo:${id}`) : null)
          }
          selectedSurveyId={selectedSurveyId}
          callouts={calloutDraws}
          selectedCalloutId={selectedCalloutId}
          onSelectCallout={(id) => {
            setSelectedCalloutId(id);
            // Tapping a held-open photograph on the map PICKS that
            // photograph, so its own card comes up with the controls on it.
            // Without this the card could be showing a different picture and
            // the size slider would resize something you are not looking at.
            if (!id) return;
            const held = plan.callouts.find((c) => c.id === id);
            if (!held) return;
            setStripPick(
              held.photoId.startsWith("event:")
                ? held.photoId
                : `photo:${held.photoId}`,
            );
          }}
          onMoveCallout={moveCallout}
          plants={plan.plants}
          plantFace={plantFace}
          selectedPlantId={selectedPlantId}
          onSelectPlant={setSelectedPlantId}
          onPlacePlant={placePlant}
          onMovePlant={movePlant}
          pinsDraggable={mode === "review"}
          onMovePin={handleMovePin}
          rightAngle={rightAngle}
          smoothNew={smoothNew}
          labelFor={labelFor}
          tool={tool}
          selectedShapeId={selectedId}
          onSelectShape={(id) => {
            // While armed, a tap on a take-off attaches rather than selects.
            // A tap on bare ground (null) cancels, which is the same way out
            // as the button and needs no aiming.
            if (linkArmed && linkablePhoto) {
              if (id) attachPhoto(id);
              else setLinkArmed(false);
              return;
            }
            setSelectedId(id);
          }}
          pending={pending}
          onPendingChange={setPending}
          onCloseArea={finish}
          onMoveNodes={moveNodes}
          onMergeNodes={mergeNodes}
          onLinkSurvey={linkNodeToSurvey}
          onInsertVertex={insertVertex}
          onToggleVertexSmooth={toggleVertexSmooth}
          showMeasurements={showMeasurements}
          aligning={aligning}
          onAlignCommit={(georef: Georef) =>
            aligning && patchOverlay(aligning.id, { georef })
          }
          scaling={scaling}
          scalePoints={scalePoints}
          onScalePointsChange={setScalePoints}
        />

        {/*
          The clip for wherever the playhead is, over the canvas.

          Mounted for the whole life of the screen and hidden with `hidden`,
          NEVER rendered conditionally: unmounting a <video> and putting it
          back restarts playback from zero on iOS Safari, which is the same
          reason Upright's review swaps its panes by class. It only takes the
          stage while Review is showing and a clip is actually running.
        */}
        </div>

        {/*
          The clip is NOT gated on the column's mode.

          It was, and that was the bug: the transport and the filmstrip belong
          to the screen, so audio played in either mode while the picture only
          appeared in Review — audio with no video, and nothing saying why. The
          clip is the fourth piece of the same shared replay, and the moment you
          most want to see what the yard looked like is while you are in Plan
          laying beds out against it.
        */}
        {visit && (
          <ReviewVideo
            session={visit}
            drift={drift}
            audioRef={audioRef}
            onStage={videoOnStage}
          />
        )}

        {/*
          THE STAGE AS A PHOTO VIEWER.

          `photoStage` is a MODE, not a picture: it says the stage is showing
          whatever the strip has picked. So tapping along the strip while it is
          on leafs through the yard at full size, which is what looking at a
          set of site photographs actually is — and clearing the pick shows the
          map again, because there is then nothing to look at.

          Both conditions are on the render rather than baked into the flag, so
          the mode survives a gap: pick nothing, and the map is back; pick the
          next frame, and it is big again. A flag that switched itself off
          whenever the pick cleared would make the strip feel like it kept
          closing the viewer.
        */}
        {photoStage && pickedFrame && <ReviewPhotoStage frame={pickedFrame} />}

        {/*
          The toggle, and it appears only once there is something to show — a
          button that opens a black rectangle is worse than no button. Top
          left: the zoom controls own bottom left, the running total owns
          bottom right, and the phone's Panel button owns top right. Above the
          viewer's own z so the way out is the same button in the same place
          rather than a second control that only exists while it is open.
        */}
        {pickedFrame && (
          <button
            onClick={() => setPhotoStage((v) => !v)}
            aria-pressed={photoStage}
            title={
              photoStage
                ? "Back to the map"
                : "Show the picked photograph over the map"
            }
            className={`absolute left-3 top-3 z-40 flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-bold backdrop-blur ${
              photoStage ? "bg-accent text-black" : "bg-bg/90 text-ink"
            }`}
          >
            <span aria-hidden="true">{photoStage ? "\u{1F5FA}\u{FE0F}" : "\u{1F5BC}\u{FE0F}"}</span>
            {photoStage ? "Map" : "Photo"}
          </button>
        )}

        </div>

        {/*
          The way in on a phone. Top right of the map, clear of the zoom
          controls bottom left and the running-total pill bottom right, and
          outside the tool row — which scrolls sideways, so anything in it can
          be off screen exactly when it is needed. Ringed while there is no
          property, because then it is the only thing worth pressing.
        */}
        <button
          onClick={() => setPanelOpen(true)}
          className={`absolute right-3 top-3 z-30 flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-bold backdrop-blur sm:hidden ${
            ready ? "bg-bg/90 text-ink" : "bg-accent text-black"
          }`}
        >
          <span aria-hidden="true">☰</span>
          {ready ? "Panel" : "Choose property"}
        </button>

        {panelOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 sm:hidden"
            onPointerDown={() => setPanelOpen(false)}
          />
        )}

        <aside
          className={`shrink-0 flex-col gap-2 overflow-y-auto md-scroll sm:static sm:z-auto sm:flex sm:w-64 sm:max-w-none sm:border-0 sm:bg-transparent sm:p-0 ${
            panelOpen
              ? "fixed inset-y-0 right-0 z-40 flex w-72 max-w-[85vw] border-l border-edge bg-bg p-3"
              : "hidden"
          }`}
        >
          <button
            onClick={() => setPanelOpen(false)}
            className="shrink-0 rounded-xl bg-surface2 px-4 py-2.5 text-sm font-bold text-ink sm:hidden"
          >
            Close
          </button>

          {/*
            The one switch this screen turns on. The column is the only thing
            that changes: the canvas, the filmstrip and the transport below are
            shared, so the visit and the take-off are two readings of one yard
            rather than two screens.
          */}
          <div className="flex shrink-0 gap-1 rounded-xl bg-surface2 p-1">
            {(["review", "plan"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold capitalize ${
                  mode === m ? "bg-accent text-black" : "text-muted"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/*
            A picked PROPERTY photograph, while the column is on the plan.

            The strip is shared by both modes but the preview lives in Review,
            and a session pin picked here still lights itself on the canvas —
            so a pick has feedback either way. A photograph from an appointment
            has no pin to light (its position is not read), so without this a
            tap on one would do nothing visible at all. Additive: it sits above
            the cards rather than moving them.
          */}
          {mode === "plan" && stripPick?.startsWith("event:") && pickedFrame && (
            <div className="shrink-0 overflow-hidden rounded-2xl border border-edge bg-surface">
              {/*
                THE PREVIEW IS A DRAG SOURCE, and what it drags is different
                from what the strip drags.

                A frame out of the STRIP asks "where was this taken" and
                answers it with a dot. The picture out of the PREVIEW asks to
                be held open on the plan itself — the same photograph, a
                different question, so the same gesture from the two places
                means two things and each is the obvious one for where it
                started.

                Only once it has a dot. A call-out is a line from a picture to
                a place, and without the dot there is no place — so the strip's
                own drag comes first, and the caption says so rather than
                letting the gesture fail silently.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-preview="picked"
                src={pickedFrame.url}
                alt=""
                draggable={false}
                onPointerDown={(e) => {
                  if (!pickedHasDot || !selectedPhotoId) return;
                  beginCalloutDrag(
                    selectedPhotoId,
                    pickedFrame.url,
                    pickedFrame.title,
                    e,
                  );
                }}
                /*
                  A FIXED HEIGHT, not a maximum.

                  A broken image has no intrinsic size, so `max-h` let the
                  preview collapse to nothing — the card kept its caption and
                  the picture's place in it simply vanished, which reads as a
                  photograph that has no preview rather than one that failed.
                  It also left nothing to drag: this is the drag source for a
                  call-out, and a zero-height target cannot be picked up.
                */
                className={`h-44 w-full bg-surface2 object-cover ${
                  pickedHasDot ? "cursor-grab touch-none" : ""
                }`}
              />
              <div className="px-3 py-2">
                <p className="text-xs font-bold text-ink">{pickedFrame.title}</p>
                {pickedFrame.note && (
                  <p className="text-[0.65rem] text-muted">{pickedFrame.note}</p>
                )}
                {/*
                  The size lives HERE rather than on the map, beside Put away,
                  because this card is already the one place a held-open
                  photograph is administered — and because a handle on the
                  frame itself would be a fifth thing to hit-test on a surface
                  where a picture already sits over the ground it is about.

                  It is the same control the layers get for the same job, which
                  is the point: sizing a picture on the plan is one idea, not
                  two that happen to look alike.
                */}
                {pickedCalloutId ? (
                  <>
                    <label className="mt-1.5 flex items-center gap-2">
                      <span className="w-8 shrink-0 text-[0.6rem] text-muted">Size</span>
                      <input
                        type="range"
                        min={CALLOUT_MIN_W}
                        max={CALLOUT_MAX_W}
                        value={calloutWidth(pickedCalloutWidth)}
                        aria-label="Call-out size"
                        onChange={(e) => {
                          if (selectedPhotoId) {
                            setCalloutWidth(selectedPhotoId, Number(e.target.value));
                          }
                        }}
                        className="w-full"
                      />
                    </label>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (selectedPhotoId) removeCalloutFor(selectedPhotoId);
                          setSelectedCalloutId(null);
                        }}
                        title="Take this photograph off the plan"
                        className="rounded-lg bg-surface2 px-2.5 py-1.5 text-[0.65rem] font-bold text-[#fca5a5]"
                      >
                        Put away
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[0.65rem] text-muted">
                      {pickedHasDot
                        ? "Drag onto the map to hold it open there"
                        : "Drop it on the map from the strip first"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === "review" ? (
            <>
              <ReviewCard
                chosen={plan.review}
                propertyId={estimate.propertyId ?? null}
                picking={pickingReview}
                onPicking={setPickingReview}
                onChoose={setReviewSession}
              />
              {pinError && (
                <p className="shrink-0 rounded-xl border border-[#fca5a5] bg-surface p-2 text-xs leading-relaxed text-[#fca5a5]">
                  {pinError}
                </p>
              )}
              {visit && (
                <p className="shrink-0 px-1 text-[0.65rem] leading-relaxed text-muted">
                  Drag a pin to correct where it sits. That writes back to
                  Upright and every elevation derived from it moves with it.
                </p>
              )}
              <ReviewColumn
                session={visit}
                segments={segments}
                transcriptStatus={transcriptStatus}
                audioMs={audioMs}
                drift={drift}
                playing={playing}
                onSeek={seekMs}
                picked={pickedFrame}
                link={
                  linkablePhoto
                    ? {
                        documents: photoDocuments,
                        arming: linkArmed,
                        onArm: () => setLinkArmed(true),
                        onCancel: () => setLinkArmed(false),
                        onUnlink: (shapeId) =>
                          unlinkPhotoFromShape(shapeId, linkablePhoto.photoId),
                      }
                    : null
                }
              />
            </>
          ) : (
          <>
          <AnchorCard
            estimate={estimate}
            picking={picking}
            onPicking={setPicking}
          />
          <SurveyCard
            chosen={plan.survey}
            layer={survey}
            picking={pickingSurvey}
            onPicking={setPickingSurvey}
          />
          {overlays.length > 0 && (
            <LayersCard
              overlays={overlays}
              onMove={moveLayer}
              hidden={plan.hiddenOverlayIds}
              aligningId={aligningId}
              onAlign={startAligning}
              onStopAligning={stopAligning}
              onPatch={patchOverlay}
              onRemove={(id) => {
                setOverlays((c) => c.filter((o) => o.id !== id));
                void deleteLayer(id);
              }}
            />
          )}
          {/*
            THE PLANTS, AS A BILL RATHER THAN AS A LIST OF SYMBOLS.

            Grouped by species, because twelve rows all saying "Shrub" is not
            something anybody can read and the COUNT is the answer here — a
            plant take-off is a schedule of quantities, which is exactly what
            the proposal turns it into.

            Above the shapes: a plan is read plants-first when there are any,
            and a bill that sat under nine beds would need scrolling to.
          */}
          {plantKinds.length > 0 && (
            <PlantsCard
              kinds={plantKinds}
              selected={selectedPlant}
              selectedName={selectedPlant ? plantName(selectedPlant) : null}
              onRemoveSelected={() => {
                if (!selectedPlant) return;
                removePlant(selectedPlant.id);
                setSelectedPlantId(null);
              }}
              onNameSelected={() => {
                if (!selectedPlant) return;
                setTool("plant");
                setPlantPick({
                  itemId: selectedPlant.itemId,
                  ...(selectedPlant.variantId
                    ? {
                        variantId: selectedPlant.variantId,
                        variantLabel: selectedPlant.variantLabel,
                      }
                    : {}),
                });
                setNamingGroup(plantGroupOf(selectedPlant.itemId)?.group ?? null);
              }}
              onApplyPick={() => {
                if (!selectedPlant) return;
                setPlantVariant(
                  selectedPlant.id,
                  plantPick.variantId
                    ? {
                        variantId: plantPick.variantId,
                        variantLabel: plantPick.variantLabel,
                      }
                    : null,
                );
              }}
              pickLabel={plantPick.variantLabel ?? null}
              onRemoveKind={(itemId, variantId) => {
                removePlantsOfKind(itemId, variantId);
                setSelectedPlantId(null);
              }}
              glyphFor={(itemId) => getItem(itemId)?.glyph ?? "🌿"}
            />
          )}

          {plan.shapes.length === 0 ? (
            <p className="px-1 text-xs leading-relaxed text-muted">
              No shapes yet. Draw a bed with Area or a run with Linear, and link
              it to the assembly it buys. Plant counts the third way: one tap,
              one plant.
            </p>
          ) : (
            plan.shapes.map((shape) => (
              <ShapeCard
                key={shape.id}
                shape={shape}
                nodes={plan.nodes}
                survey={survey}
                sharedCount={
                  shape.vertices.filter((v) => shared.has(v)).length
                }
                onDetach={() => detachShape(shape.id)}
                settings={settings}
                selected={shape.id === selectedId}
                onSelect={() => {
                  setSelectedId(shape.id);
                  chooseTool("select");
                }}
                onLink={(id) => updateShape(shape.id, { assemblyId: id })}
                onRemove={() => removeShape(shape.id)}
                photos={resolvePhotos(shape)}
                onUnlinkPhoto={(photoId) => unlinkPhotoFromShape(shape.id, photoId)}
              />
            ))
          )}
          </>
          )}
        </aside>
      </div>

      {/*
        The filmstrip and the transport belong to the SCREEN, not to the
        column — they stay put when the column switches to the plan's cards, so
        the pictures of the yard and the playhead are still to hand while beds
        are being drawn. That is what makes this one tool rather than two.

        The <audio> is mounted here for the life of the screen and carries no
        `src` attribute: the hook assigns it after setting crossOrigin, because
        the wrong order is captured as a tainted source and plays silence.
      */}
      {/*
        The frame under the finger.

        A drag with nothing following it is a drag you cannot aim: the whole
        question is WHERE on the map this photograph goes, and until the
        picture is under the thumb there is nothing to place. It only appears
        once the gesture has passed the threshold, so a tap that picks a frame
        never flashes a ghost.

        `pointer-events-none` so it can never be what the pointerup lands on —
        the drop has to reach the canvas underneath it.
      */}
      {dragPhoto?.moved && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border-2 border-[#c9973f] shadow-lg"
          style={{
            left: dragPhoto.x - 44,
            top: dragPhoto.y - 33,
            width: 88,
            height: 66,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dragPhoto.url} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <ReviewFilmstrip
        session={visit}
        frames={gradeFrames}
        audioMs={audioMs}
        drift={drift}
        onSeek={seekMs}
        selectedId={stripPick}
        onSelect={setStripPick}
        propertyId={estimate.propertyId}
        source={stripSource}
        onSource={setStripSource}
        events={eventPhotos}
        photoError={photoError}
        onDragPhoto={beginPhotoDrag}
      />
      <ReviewTransport
        session={visit}
        audioMs={audioMs}
        durationSec={durationSec}
        playing={playing}
        onToggle={toggleAudio}
        onSeek={seekMs}
        gainError={gainError}
        videoOnStage={videoOnStage}
        onToggleStage={() => setVideoOnStage((v) => !v)}
      />
      <audio ref={audioRef} preload="metadata" className="hidden" />

      {/*
        Finish / Undo / Cancel as buttons, present for the whole of a drawing
        tool rather than only once a point is down. Appearing on the first tap
        would shrink the canvas mid-gesture and slide the map under the finger
        that just placed a corner. The buttons disable instead.
      */}
      {drawing && (
        <div className="shrink-0 mt-2 mb-16 flex items-center gap-2 pr-2 sm:mb-0 sm:pr-36">
          <span className="hidden text-xs font-bold tabular-nums text-muted sm:inline">
            {pending.length} point{pending.length === 1 ? "" : "s"}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setPending([])}
            disabled={pending.length === 0}
            className="shrink-0 rounded-xl bg-surface2 px-4 py-2.5 text-sm font-bold text-muted disabled:opacity-30"
          >
            Cancel
          </button>
          <button
            onClick={() => setPending((p) => p.slice(0, -1))}
            disabled={pending.length === 0}
            className="shrink-0 rounded-xl bg-surface2 px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-30"
          >
            {/*
              Always "Undo point", never bare "Undo": the tool row now carries
              an undo for the whole plan, and two buttons reading the same word
              on one screen doing different things is a trap. This one takes
              back a corner of the shape being drawn; that one takes back the
              last thing that happened to the take-off.
            */}
            Undo point
          </button>
          <button
            onClick={finish}
            disabled={!canFinish}
            className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-30"
          >
            Finish
          </button>
        </div>
      )}

      {/* The selected shape's controls, reachable without the side list. */}
      {!drawing && selected && (
        <div className="shrink-0 mt-2 mb-16 flex items-center gap-2 pr-2 sm:hidden">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: selected.color }}
          />
          <span className="flex-1 truncate text-sm font-bold tabular-nums text-ink">
            {Math.round(measurementOf(selected, plan.nodes)).toLocaleString()}{" "}
            {selected.type === "area" ? "sq ft" : "ln ft"}
          </span>
          <button
            onClick={() => removeShape(selected.id)}
            className="rounded-xl bg-surface2 px-4 py-2.5 text-sm font-bold text-[#fca5a5]"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Which yard this is, and how well we know where it is.
 *
 * IT STATES THE YARD; IT DOES NOT ASK FOR IT. The property is settled when the
 * job is opened off the board — 86 of the 90 live deals carry a `property_id`
 * — so by the time anyone reaches the plan the question was answered two
 * screens ago, and a picker here is a second chance to disagree with the job.
 * Whoever chose it owns it: with a deal attached the card names the job as the
 * source and sends a correction back there.
 *
 * The picker is still here for the case nothing upstream covers: an estimate
 * with no deal, which is what *Skip to estimator* and the 4 propertyless deals
 * produce. There the plan IS the only place a yard can be named, and offering
 * nothing would be a dead end.
 *
 * The source is shown rather than hidden once a centre exists. Half the
 * properties on the project have coordinates and half do not, so an anchor is
 * sometimes a record and sometimes a guess, and a take-off is worth what its
 * anchor was worth. A map that opens on the office and says nothing is the
 * failure mode this card exists to prevent.
 */
function AnchorCard({
  estimate,
  picking,
  onPicking,
}: {
  estimate: Estimate;
  picking: boolean;
  onPicking: (v: boolean) => void;
}) {
  const anchor = estimate.plan.anchor;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PropertyOption[] | null>(null);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    const timer = setTimeout(() => {
      void fetchProperties(q).then((r) => {
        if (live) setRows(r);
      });
      // Debounced, because this fires on every keystroke and each one is a
      // round trip through a route handler to PostgREST.
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [picking, q]);

  if (picking) {
    return (
      <div className="rounded-2xl border border-accent bg-surface p-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the address…"
          className="w-full rounded-lg border border-edge bg-surface2 px-2 py-2 text-base text-ink"
        />
        <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto md-scroll">
          {rows === null ? (
            <p className="text-xs text-muted">Looking…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted">Nothing matches.</p>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  // The estimate is for this yard, not merely looking at it.
                  attachProperty(p.id);
                  setPlanAnchor({
                    propertyId: p.id,
                    label: p.address,
                    // A property with no coordinates still anchors the
                    // estimate to the right yard; the map just has nowhere to
                    // open yet, and the card says so.
                    centre:
                      p.located && p.lat !== null && p.lng !== null
                        ? { lat: p.lat, lng: p.lng }
                        : FALLBACK_CENTRE,
                    source: p.located ? "property" : "fallback",
                  });
                  onPicking(false);
                }}
                className="rounded-lg bg-surface2 px-2 py-2 text-left text-xs text-ink"
              >
                <span className="block truncate font-bold">{p.address}</span>
                {!p.located && (
                  <span className="text-[0.65rem] text-[#fbbf24]">
                    No coordinates on file
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <button
          onClick={() => onPicking(false)}
          className="mt-2 w-full rounded-lg bg-surface2 py-2 text-xs font-bold text-muted"
        >
          Cancel
        </button>
      </div>
    );
  }

  // The yard is the job's when a deal is attached, and this screen's when one
  // is not. Only the second gives the plan anything to change.
  const fromJob = estimate.dealId !== null && anchor?.propertyId != null;

  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">
          PROPERTY
        </span>
        {!fromJob && (
          <button
            onClick={() => onPicking(true)}
            className="text-xs font-bold text-accent"
          >
            {anchor?.propertyId != null ? "Change" : "Choose"}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm leading-snug text-ink">
        {anchor?.label ?? (anchor?.propertyId ? `#${anchor.propertyId}` : "Not chosen")}
      </p>
      {fromJob && (
        <p className="mt-0.5 text-[0.65rem] leading-tight text-muted">
          From the job — open a different one on Jobs to change it.
        </p>
      )}
      {anchor?.source === "upright" && anchor.propertyId === null && (
        <p className="mt-0.5 text-[0.65rem] leading-tight text-muted">
          The map is on the survey — pick the property to attach the estimate.
        </p>
      )}
      {anchor && (
        <p
          className={`mt-0.5 text-[0.65rem] leading-tight ${
            anchor.source === "fallback" ? "text-[#fbbf24]" : "text-muted"
          }`}
        >
          {ANCHOR_BLURB[anchor.source]}
        </p>
      )}
    </div>
  );
}

/**
 * Upright's elevation survey, as a layer.
 *
 * Chosen by session rather than by property because that is what the data
 * supports: 48 sessions carry survey points and one carries a property_id. The
 * list is the sessions that actually have points — not the same set as the
 * ones with audio, since most grade work is shot without recording anything.
 *
 * Read-only. It was measured on site with the anchor cancellation that makes
 * it mean something; this screen lays beds out against it rather than
 * correcting it.
 */
function SurveyCard({
  chosen,
  layer,
  picking,
  onPicking,
}: {
  chosen: { sessionId: string; label: string } | null;
  layer: SurveyLayer | null;
  picking: boolean;
  onPicking: (v: boolean) => void;
}) {
  const [rows, setRows] = useState<UprightSurveySession[] | null>(null);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    void fetchSurveySessions().then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [picking]);

  if (picking) {
    return (
      <div className="rounded-2xl border border-accent bg-surface p-3">
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">
          UPRIGHT SURVEY
        </span>
        <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto md-scroll">
          {rows === null ? (
            <p className="text-xs text-muted">Looking…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted">
              No sessions with survey points. Shoot grade in Upright and it
              shows up here.
            </p>
          ) : (
            rows.map((r) => {
              const when = r.startedAt
                ? new Date(r.startedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "undated";
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setSurveySession({
                      sessionId: r.id,
                      label: r.propertyAddress
                        ? `${r.propertyAddress} · ${when}`
                        : `Survey · ${when}`,
                    });
                    onPicking(false);
                  }}
                  className="rounded-lg bg-surface2 px-2 py-2 text-left text-xs text-ink"
                >
                  <span className="block truncate font-bold">
                    {r.propertyAddress ?? "Untagged session"}
                  </span>
                  <span className="text-[0.65rem] text-muted">
                    {when} · {r.elevationPointCount} points
                  </span>
                </button>
              );
            })
          )}
        </div>
        <button
          onClick={() => onPicking(false)}
          className="mt-2 w-full rounded-lg bg-surface2 py-2 text-xs font-bold text-muted"
        >
          Cancel
        </button>
      </div>
    );
  }

  const measured =
    layer?.points.filter((p) => p.elevation.state === "measured").length ?? 0;
  const unplaced =
    layer?.points.filter((p) => p.elevation.state === "unplaced").length ?? 0;

  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-bold tracking-widest text-muted">
          SURVEY
        </span>
        <div className="flex items-center gap-2">
          {chosen && (
            <button
              onClick={() => setSurveySession(null)}
              className="text-xs font-bold text-[#fca5a5]"
            >
              Hide
            </button>
          )}
          <button
            onClick={() => onPicking(true)}
            className="text-xs font-bold text-accent"
          >
            {chosen ? "Change" : "Show"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm leading-snug text-ink">
        {chosen?.label ?? "None"}
      </p>
      {chosen && layer && (
        <p className="mt-0.5 text-[0.65rem] leading-tight text-muted">
          {measured} measured
          {layer.runs.length > 0 && ` · ${layer.runs.length} slope runs`}
          {/* An unplaced pin is not a measurement, and saying so beats
              quietly drawing it as though it were. */}
          {unplaced > 0 && (
            <span className="text-[#fbbf24]"> · {unplaced} still to place</span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The property's georeferenced layers.
 *
 * `scaleLocked` is the distinction worth reading here. Until an overlay's
 * width has been set from a dimension somebody read off the drawing, it is a
 * picture in roughly the right place — every measurement taken against it
 * inherits however wrong that guess was. The card says which it is rather than
 * letting a placed image imply a survey.
 */
function LayersCard({
  overlays,
  onMove,
  hidden,
  aligningId,
  onAlign,
  onStopAligning,
  onPatch,
  onRemove,
}: {
  overlays: MapOverlay[];
  onMove: (id: string, delta: 1 | -1) => void;
  hidden: string[];
  aligningId: string | null;
  onAlign: (id: string) => void;
  onStopAligning: () => void;
  onPatch: (id: string, patch: Partial<MapOverlay>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      <span className="text-[0.65rem] font-bold tracking-widest text-muted">
        LAYERS
      </span>
      {/*
        TOP OF THE LIST IS TOP OF THE STACK.

        `overlays` arrives sorted by z, lowest first, because that is the order
        the canvas draws them in. Listing it that way round would put the layer
        somebody is looking at — the one on top — at the bottom of the card,
        and make an up arrow mean "draw underneath". Every tool that has ever
        had layers lists them the other way, so this reverses for display and
        the arrows mean what they look like.
      */}
      <div className="mt-2 flex flex-col gap-3">
        {[...overlays].reverse().map((o, i, list) => {
          const off = hidden.includes(o.id);
          return (
            <div key={o.id}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOverlayHidden(o.id, !off)}
                  className="shrink-0 text-sm"
                  aria-label={off ? `Show ${o.label}` : `Hide ${o.label}`}
                >
                  {off ? "○" : "◉"}
                </button>
                <span
                  className={`flex-1 truncate text-xs font-bold ${
                    off ? "text-muted" : "text-ink"
                  }`}
                >
                  {o.label}
                </span>
                <button
                  onClick={() => onMove(o.id, 1)}
                  disabled={i === 0}
                  aria-label={`Bring ${o.label} forward`}
                  title="Bring forward"
                  className="shrink-0 rounded-lg px-1 text-xs text-muted disabled:opacity-20"
                >
                  ▲
                </button>
                <button
                  onClick={() => onMove(o.id, -1)}
                  disabled={i === list.length - 1}
                  aria-label={`Send ${o.label} back`}
                  title="Send back"
                  className="shrink-0 rounded-lg px-1 text-xs text-muted disabled:opacity-20"
                >
                  ▼
                </button>
                <button
                  onClick={() => onRemove(o.id)}
                  aria-label={`Remove ${o.label}`}
                  className="shrink-0 rounded-lg px-1.5 text-xs text-muted"
                >
                  ✕
                </button>
              </div>

              <p className="mt-0.5 text-[0.65rem] leading-tight text-muted">
                {Math.round(o.georef.widthM)} m wide ·{" "}
                {o.scaleLocked ? (
                  <span className="text-accent">scaled</span>
                ) : (
                  <span className="text-[#fbbf24]">placed by eye</span>
                )}
                {o.source === "upright" && " · from Upright"}
              </p>

              <label className="mt-1 flex items-center gap-2">
                <span className="w-10 shrink-0 text-[0.6rem] text-muted">Fade</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(o.opacity * 100)}
                  onChange={(e) => onPatch(o.id, { opacity: Number(e.target.value) / 100 })}
                  className="w-full"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[0.6rem] text-muted">Turn</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={Math.round(o.georef.rotDeg)}
                  disabled={o.locked}
                  onChange={(e) =>
                    onPatch(o.id, {
                      georef: { ...o.georef, rotDeg: Number(e.target.value) },
                    })
                  }
                  className="w-full disabled:opacity-30"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[0.6rem] text-muted">Size</span>
                <input
                  type="range"
                  min={5}
                  max={300}
                  value={Math.round(o.georef.widthM)}
                  disabled={o.locked || o.scaleLocked}
                  onChange={(e) =>
                    onPatch(o.id, {
                      georef: { ...o.georef, widthM: Number(e.target.value) },
                    })
                  }
                  className="w-full disabled:opacity-30"
                />
              </label>
              <div className="mt-1 flex gap-1">
                <button
                  onClick={() => {
                    if (aligningId === o.id) {
                      onStopAligning();
                      return;
                    }
                    // Placing implies unlocked: the lock exists to stop a
                    // stray thumb moving a finished layer, and asking someone
                    // to unlock before they can move it is a step that only
                    // ever gets in the way of the thing they just asked for.
                    if (o.locked) onPatch(o.id, { locked: false });
                    onAlign(o.id);
                  }}
                  className={`flex-1 rounded-lg py-1.5 text-[0.65rem] font-bold ${
                    aligningId === o.id
                      ? "bg-accent text-black"
                      : "bg-surface2 text-ink"
                  }`}
                >
                  {aligningId === o.id ? "Done placing" : "Place"}
                </button>
                <button
                  onClick={() => onPatch(o.id, { locked: !o.locked })}
                  className="shrink-0 rounded-lg bg-surface2 px-2.5 py-1.5 text-[0.65rem] font-bold text-muted"
                  title={o.locked ? "Unlock" : "Lock in place"}
                >
                  {o.locked ? "🔒" : "🔓"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One shape.
 *
 * Shows the measurement, the assembly it buys, the loads that implies and what
 * those loads actually cover — so the gap between what was drawn and what will
 * be bought is on screen rather than discovered on the invoice.
 */
/**
 * The plant schedule: what is on the plan, by species and count.
 *
 * A card rather than a row per symbol. Twelve identical "Shrub" lines say
 * nothing a single "Shrub x12" does not, and the schedule is what a plant
 * take-off IS — the proposal reads exactly these numbers.
 *
 * The selected symbol gets its own strip at the bottom, which is where naming
 * happens: you find out a bed wants three of something specific while looking
 * at the plan, not while standing at the grid, so a plant placed generic has
 * to be nameable where it stands.
 */
function PlantsCard({
  kinds,
  selected,
  selectedName,
  onRemoveSelected,
  onNameSelected,
  onApplyPick,
  pickLabel,
  onRemoveKind,
  glyphFor,
}: {
  kinds: { key: string; itemId: string; variantId?: string; label: string; count: number }[];
  selected: PlacedPlant | null;
  selectedName: string | null;
  onRemoveSelected: () => void;
  onNameSelected: () => void;
  onApplyPick: () => void;
  pickLabel: string | null;
  onRemoveKind: (itemId: string, variantId?: string) => void;
  glyphFor: (itemId: string) => string;
}) {
  const total = kinds.reduce((sum, k) => sum + k.count, 0);
  return (
    <div className="shrink-0 rounded-2xl border border-edge bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-bold text-ink">Plants</span>
        <span className="text-xs tabular-nums text-muted">
          {total} placed
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {kinds.map((kind) => (
          <div key={kind.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="shrink-0 text-sm">
              {glyphFor(kind.itemId)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink">
              {kind.label}
            </span>
            <span className="shrink-0 text-xs font-bold tabular-nums text-ink">
              ×{kind.count}
            </span>
            <button
              onClick={() => onRemoveKind(kind.itemId, kind.variantId)}
              title={`Remove all ${kind.count} ${kind.label}`}
              className="shrink-0 rounded-lg bg-surface2 px-2 py-1 text-[0.65rem] font-bold text-muted"
            >
              Clear
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="mt-2 border-t border-edge pt-2">
          <p className="mb-1.5 truncate text-[0.7rem] font-bold text-ink">
            {selectedName}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={onNameSelected}
              className="rounded-lg bg-surface2 px-2.5 py-1.5 text-[0.65rem] font-bold text-ink"
            >
              Name it
            </button>
            {/*
              Only where a name is armed and it is not already this plant's.
              A button that would do nothing is worse than no button — it says
              there is something left to do.
            */}
            {pickLabel && pickLabel !== selected.variantLabel && (
              <button
                onClick={onApplyPick}
                className="rounded-lg bg-accent px-2.5 py-1.5 text-[0.65rem] font-bold text-black"
              >
                Make it {pickLabel}
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={onRemoveSelected}
              title="Remove this plant"
              className="rounded-lg bg-surface2 px-2.5 py-1.5 text-[0.65rem] font-bold text-[#fca5a5]"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShapeCard({
  shape,
  nodes,
  survey,
  sharedCount,
  onDetach,
  settings,
  selected,
  onSelect,
  onLink,
  onRemove,
  photos,
  onUnlinkPhoto,
}: {
  shape: PlanShape;
  nodes: PlanNodes;
  survey: SurveyLayer | null;
  /** How many of this shape's corners another shape also holds. */
  sharedCount: number;
  onDetach: () => void;
  settings: EstimatorSettings;
  selected: boolean;
  onSelect: () => void;
  onLink: (assemblyId: string | null) => void;
  onRemove: () => void;
  /**
   * The photographs attached to this shape, resolved against the loaded visit.
   *
   * Resolved rather than read straight off the link, because a stored url can
   * be superseded — Upright writes a NEW storage path when a picture is
   * replaced. The live row wins where there is one; the copied url is the
   * fallback that keeps the card drawable with no session loaded at all.
   */
  photos: { photoId: string; url: string; label: string; live: boolean }[];
  onUnlinkPhoto: (photoId: string) => void;
}) {
  const measurement = measurementOf(shape, nodes);
  const options = assembliesForShape(ASSEMBLY_MODELS, shape.type);
  const model = shape.assemblyId ? getAssembly(shape.assemblyId) : undefined;
  const buckets = bucketsForMeasurement(measurement, model?.bucketSize ?? null);
  const bought = workBought(buckets, model?.bucketSize ?? null);
  const cost =
    model && buckets > 0
      ? takeoff(model, buckets).reduce(
          (s, l) => s + l.quantity * l.item.costPerUnit,
          0,
        )
      : 0;
  const unit = shape.type === "area" ? "sq ft" : "ln ft";
  /*
    How many of this shape's corners are rounded.

    A count rather than a flag, because a shape is not one or the other: a bed
    that runs straight along a drive and sweeps round the lawn is two sharp
    corners and the rest rounded, which is what storing this per corner was
    always for. The button underneath therefore says what it will DO rather
    than what the shape IS — `Curved` on a shape with three of eight corners
    rounded was a label that could only mislead.
  */
  const roundCount = (shape.smoothVertices ?? []).filter((v) =>
    shape.vertices.includes(v),
  ).length;
  const allStraight = roundCount === 0;

  /**
   * What the survey makes of this shape's corners.
   *
   * The fall across a bed is the number worth having: an area tells you how
   * much mulch, and the fall tells you whether it drains. It is only reported
   * when at least two corners are on shot points, because one measured corner
   * and three guessed ones is not a grade.
   */
  const grade = useMemo(() => {
    const linked = surveyedCorners(shape, nodes);
    if (linked.length === 0) return null;
    const heights: { label: string; ft: number }[] = [];
    for (const { link } of linked) {
      const point = survey?.points.find((p) => p.id === link.pointId);
      const ft = point ? elevationFeet(point.elevation) : null;
      if (ft !== null) heights.push({ label: link.label, ft });
    }
    if (heights.length < 2) {
      return { corners: linked.length, measured: heights.length, fall: null };
    }
    const low = heights.reduce((a, b) => (b.ft < a.ft ? b : a));
    const high = heights.reduce((a, b) => (b.ft > a.ft ? b : a));
    return {
      corners: linked.length,
      measured: heights.length,
      fall: { ft: high.ft - low.ft, from: high.label, to: low.label },
    };
  }, [shape, nodes, survey]);

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border bg-surface p-3 ${
        selected ? "border-accent" : "border-edge"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: shape.color }}
        />
        <span className="flex-1 text-sm font-bold tabular-nums text-ink">
          {Math.round(measurement).toLocaleString()} {unit}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Delete shape"
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-muted"
        >
          ✕
        </button>
      </div>

      <select
        value={shape.assemblyId ?? ""}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onLink(e.target.value || null)}
        className="mt-2 w-full rounded-lg border border-edge bg-surface2 px-2 py-2 text-xs text-ink"
      >
        <option value="">Measure only</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name.replace(" – Standard", "")}
          </option>
        ))}
      </select>

      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShapeSmooth(shape.id, allStraight);
          }}
          className="rounded-lg bg-surface2 px-2.5 py-1 text-[0.65rem] font-bold text-ink"
        >
          {allStraight ? "Round all" : "Straighten all"}
        </button>
        {/*
          The per-corner control has no button of its own: tapping a corner of
          the selected shape on the map is the whole gesture. Said whatever
          state the shape is in — it used to appear only on an already-rounded
          shape, which is the one case where you did not need telling.
        */}
        <span className="text-[0.65rem] leading-tight text-muted">
          {roundCount > 0 && roundCount < shape.vertices.length
            ? `${roundCount} of ${shape.vertices.length} corners rounded · tap one on the map to swap it`
            : "tap a corner on the map to round it or hold it sharp"}
        </span>
      </div>

      {grade && (
        <p className="mt-1.5 text-[0.7rem] leading-snug text-muted">
          <span style={{ color: SURVEY_COLORS.target }}>◎</span>{" "}
          {grade.corners} corner{grade.corners === 1 ? "" : "s"} surveyed
          {grade.fall ? (
            <>
              {" · falls "}
              <span className="font-bold text-ink">
                {grade.fall.ft.toFixed(2)}&apos;
              </span>
              {` from ${grade.fall.from} to ${grade.fall.to}`}
            </>
          ) : grade.measured < 2 ? (
            // One measured corner is a height, not a grade. Saying so beats
            // reporting a fall of zero from a shape nobody levelled.
            <span className="text-[#fbbf24]">
              {" "}
              · link a second corner for a fall
            </span>
          ) : null}
        </p>
      )}

      {photos.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[0.7rem] text-muted">
            {photos.length} photo{photos.length === 1 ? "" : "s"} from the visit
          </p>
          {/*
            A row that scrolls sideways rather than a grid that grows downward:
            the card sits in a column beside the map, and a bed with eight
            photographs must not push the next bed off the screen.
          */}
          <ul className="flex gap-1.5 overflow-x-auto pb-1">
            {photos.map((p) => (
              <li key={p.photoId} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.label}
                  title={p.live ? p.label : `${p.label} — from another visit`}
                  className="h-14 w-20 rounded-lg object-cover"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnlinkPhoto(p.photoId);
                  }}
                  aria-label={`Detach ${p.label}`}
                  className="absolute right-0.5 top-0.5 rounded-md bg-black/70 px-1 text-[0.6rem] font-bold text-white"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sharedCount > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[0.7rem] text-muted">
          <span>
            Shares {sharedCount} corner{sharedCount === 1 ? "" : "s"}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDetach();
            }}
            className="rounded-md bg-surface2 px-2 py-0.5 text-[0.65rem] font-bold text-ink"
            // The way out of a join. A mis-aimed tap can weld a bed to a lawn
            // it was never meant to touch, and without this the only remedy
            // would be redrawing it.
            title="Give this shape its own copies of the shared corners"
          >
            Detach
          </button>
        </p>
      )}

      {model && buckets > 0 && (
        <p className="mt-2 text-[0.7rem] leading-snug text-muted">
          <span className="font-bold text-ink">
            {buckets} load{buckets === 1 ? "" : "s"}
          </span>{" "}
          · buys {bought.toLocaleString()} {unitOfWorkLabel(model.unitOfWork)}
          {bought > measurement && (
            <span className="text-[#fbbf24]">
              {" "}
              ({Math.round(bought - measurement).toLocaleString()} over)
            </span>
          )}
          {settings.showPrices && cost > 0 && (
            <span className="block font-bold text-ink">
              {formatMoney(sellFor(cost, settings.markupPercent))}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
