"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * TWO FULLSCREENS, and the app's own is the one that always works.
 *
 * The browser's Fullscreen API takes the browser's own chrome with it, which
 * is the bigger prize — but `requestFullscreen` on an ELEMENT is refused on
 * iPhone Safari outright and its support on iPad has changed more than once,
 * and this app is used on an iPad in a driveway. So the substance is the app's
 * own: the page goes `fixed inset-0` and covers everything, which needs no API
 * and no permission. The real thing is asked for on top, and a refusal is
 * swallowed rather than reported — there is nothing for a person to do about
 * it and the map is already filling the window.
 *
 * Lifted out of PlanPage whole, and it is the cleanest thing in that file to
 * lift: its only input is the element to expand, it touches nothing else on
 * the page, and it is ninety lines of platform-quirk handling that nobody
 * reading the take-off code needs to walk past.
 */
export function useFullscreen(rootRef: RefObject<HTMLElement | null>): {
  fullscreen: boolean;
  toggleFullscreen: () => void;
} {
  const [fullscreen, setFullscreen] = useState(false);

  /*
    ONE WAY OUT, AND EVERY EXIT GOES THROUGH IT.

    The two fullscreens have to leave together. An earlier version had the
    Escape key clear the app's state and leave the browser's alone, so the page
    came back to its ordinary layout while the document was still the
    fullscreen element — the map measured 56px taller than it had before going
    in, and nothing on screen said why. The browser's own chrome would have
    been missing on a real machine.
  */
  const leaveFullscreen = useCallback(() => {
    setFullscreen(false);
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      webkitFullscreenElement?: Element | null;
    };
    try {
      if (document.fullscreenElement ?? doc.webkitFullscreenElement) {
        void (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(
          () => {},
        );
      }
    } catch {
      // Already out, or never in. The app's own layout is what matters.
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (fullscreen) {
      leaveFullscreen();
      return;
    }
    setFullscreen(true);
    const el = rootRef.current as
      | (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> })
      | null;
    try {
      void (el?.requestFullscreen?.() ?? el?.webkitRequestFullscreen?.())?.catch(
        () => {},
      );
    } catch {
      // Refused, or not implemented. The app's own fullscreen stands.
    }
  }, [fullscreen, leaveFullscreen, rootRef]);

  /*
    THE WAYS OUT THAT ARE NOT THE BUTTON.

    Escape, because every fullscreen anybody has ever used answers to it — and
    the browser's own fullscreen answers to it whether or not we listen, so
    without this the chrome would come back while the app stayed covered.
    `fullscreenchange` catches that from the other side: leaving by the
    browser's control, or by a gesture we never see.
  */
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leaveFullscreen();
    };
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      if (!(document.fullscreenElement ?? doc.webkitFullscreenElement)) {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
    /*
      Only while it is on. A `fullscreenchange` listener running the rest of
      the time would fire on somebody putting a VIDEO fullscreen — the review
      clip, on this very screen — and drop them out of a mode they were not in,
      which is harmless, and would also run on every page that mounts this one.
    */
  }, [fullscreen, leaveFullscreen]);

  return { fullscreen, toggleFullscreen };
}
