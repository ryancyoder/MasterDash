"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The master audio, and the playhead everything else in review reads.
//
// Two things here are load-bearing and both fail SILENTLY when got wrong,
// which is why each carries its own guard rather than sharing one.
//
// 1. CORS BEFORE SRC. The audio is a cross-origin Storage URL. An element
//    without `crossOrigin` set BEFORE `src` is captured by Web Audio as a
//    tainted source: no error is raised, no exception is thrown, and playback
//    is simply silent. Setting it afterwards is too late.
//
// 2. THE GRAPH CAPTURES THE ELEMENT. Once `createMediaElementSource()`
//    succeeds, the element's audio no longer reaches the speakers on its own —
//    it goes only where the graph sends it. So a throw anywhere downstream of
//    that call is total silence rather than a degraded sound, and the recovery
//    is to connect the source straight to the destination. That is why the
//    source creation and the chain that follows it are in SEPARATE try/catch
//    blocks. Collapsing them into one would mean a failure while building the
//    compressor left a live source connected to nothing.
//
// The boost is not optional decoration: these are recordings made by an iPad
// held at arm's length in a yard, and they come back very quiet. The
// compressor after it is a limiter, there so that 14x does not clip the loud
// parts into distortion.

/** Upright's value, and quiet recordings are the reason for it. */
const REVIEW_GAIN = 14.0;

export interface ReviewAudio {
  /** Attach to the single <audio> element. */
  ref: React.RefObject<HTMLAudioElement | null>;
  /** Playhead, in ms on the AUDIO's own clock. */
  audioMs: number;
  /** The file's real length in seconds — the numerator of the drift ratio. */
  durationSec: number | null;
  playing: boolean;
  /** True once the graph is wired, or once we know it could not be. */
  ready: boolean;
  toggle: () => void;
  seekMs: (ms: number) => void;
  /** Set when the boost could not be applied, so the UI can say why it is quiet. */
  gainError: string | null;
}

export function useReviewAudio(src: string | null): ReviewAudio {
  const ref = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const [audioMs, setAudioMs] = useState(0);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [gainError, setGainError] = useState<string | null>(null);

  /**
   * Point the element at the file — CORS FIRST, IMPERATIVELY.
   *
   * `crossOrigin` must be set before `src`, or Web Audio captures a tainted
   * source and plays silence with no error raised. JSX gives no guarantee
   * about the order two attributes are applied in, so the element is rendered
   * with no `src` at all and gets one here, after the flag is on.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.crossOrigin = "anonymous";
    if (src) el.src = src;
    else el.removeAttribute("src");
  }, [src]);

  // A new session means a new file, so the playhead, the length and the
  // playing flag all stop meaning anything.
  //
  // Adjusted during render rather than in an effect. Resetting in an effect
  // renders once with the OLD session's playhead against the NEW session's
  // audio — briefly showing a position that belongs to neither — and then
  // renders again to correct it. This is React's documented way to reset
  // state when an input changes, and it costs no extra commit.
  const [lastSrc, setLastSrc] = useState(src);
  if (lastSrc !== src) {
    setLastSrc(src);
    setAudioMs(0);
    setDurationSec(null);
    setPlaying(false);
    setReady(false);
  }

  /**
   * Build the graph on the first play.
   *
   * Deliberately not on mount: an AudioContext created before a user gesture
   * starts suspended in every current browser, and a suspended context on a
   * captured element is the silent failure above wearing a different hat.
   */
  const ensureGraph = useCallback(() => {
    const el = ref.current;
    if (!el || sourceRef.current) return;

    let ctx: AudioContext;
    let source: MediaElementAudioSourceNode;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("no AudioContext");
      ctx = new Ctor();
      source = ctx.createMediaElementSource(el);
    } catch {
      // The element was never captured, so it still plays through the speakers
      // by itself. Quiet, but audible — nothing to repair.
      setGainError("Volume boost unavailable; playing at the recorded level.");
      setReady(true);
      return;
    }
    ctxRef.current = ctx;
    sourceRef.current = source;

    // From here the element is captured and silent unless the graph carries
    // it, so this block's failure path must always end in a connection.
    try {
      const gain = ctx.createGain();
      gain.gain.value = REVIEW_GAIN;
      const limiter = ctx.createDynamicsCompressor();
      source.connect(gain);
      gain.connect(limiter);
      limiter.connect(ctx.destination);
      setGainError(null);
    } catch {
      // The element is captured now, so it is silent until something connects
      // it. Straight to the destination: quiet, but audible.
      let note = "Volume boost unavailable; playing at the recorded level.";
      try {
        source.connect(ctx.destination);
      } catch {
        // Nothing further to try; say so rather than leaving it looking fine.
        note = "This browser would not route the audio — there will be no sound.";
      }
      setGainError(note);
    }
    setReady(true);
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    ensureGraph();
    void ctxRef.current?.resume().catch(() => {});
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [ensureGraph]);

  const seekMs = useCallback((ms: number) => {
    const el = ref.current;
    if (!el) return;
    const secs = ms / 1000;
    if (Number.isFinite(secs)) el.currentTime = Math.max(0, secs);
    // Move the playhead now rather than waiting for the next frame, so a
    // scrub feels attached to the finger.
    setAudioMs(Math.max(0, ms));
  }, []);

  // Element events, plus a frame loop while playing. `timeupdate` alone fires
  // about four times a second, which is visibly steppy for a moving playhead
  // and far too coarse to keep a video clip in step.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;

    // Coalesced to about 20 a second rather than one per frame. This value
    // re-renders the panel, the transcript and the rail, and none of them can
    // show a difference smaller than this — while the one thing that really
    // does need every frame, keeping the video clip in step, reads the element
    // directly and never goes through React at all.
    let lastPosted = -Infinity;
    const tick = () => {
      const ms = el.currentTime * 1000;
      if (Math.abs(ms - lastPosted) >= 50) {
        lastPosted = ms;
        setAudioMs(ms);
      }
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setAudioMs(el.currentTime * 1000);
    };
    const onMeta = () => {
      setDurationSec(Number.isFinite(el.duration) ? el.duration : null);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    if (el.readyState > 0) onMeta();

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
    };
  }, [src]);

  // The context outlives the component otherwise, and browsers cap how many
  // may exist at once.
  useEffect(() => {
    return () => {
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      sourceRef.current = null;
    };
  }, []);

  return { ref, audioMs, durationSec, playing, ready, toggle, seekMs, gainError };
}
