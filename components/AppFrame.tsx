"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Icon, { IconName } from "./Icon";
import { Entry, Settings } from "@/lib/types";
import { formatElapsed } from "@/lib/time";
import { saveSettings, stopAll } from "@/lib/store";
import { useTicker } from "@/lib/useStore";

const VIEWS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Board", icon: "grid" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/log", label: "Log", icon: "list" },
  { href: "/tiles", label: "Tiles", icon: "table" },
  { href: "/estimator", label: "Estimate", icon: "calculator" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

interface AppFrameProps {
  children: React.ReactNode;
  settings: Settings;
  running: { entry: Entry; label: string; color: string; glyph: string }[];
  fieldMode: boolean;
}

/**
 * The shell.
 *
 * In field mode the content is inset by black gutters on the left, right and
 * top. The gutters are not decoration — they are where the thumbs rest when the
 * iPad is held two-handed in landscape, so navigation lives there and content
 * never does.
 */
export default function AppFrame({
  children,
  settings,
  running,
  fieldMode,
}: AppFrameProps) {
  const pathname = usePathname();
  const [showContexts, setShowContexts] = useState(false);
  const now = useTicker(running.length > 0);

  const primary = running[0];
  const elapsed = primary
    ? formatElapsed(now - new Date(primary.entry.startedAt).getTime())
    : null;

  const clock = useClock();

  const runawayMinutes = useMemo(() => {
    if (!primary) return 0;
    return (now - new Date(primary.entry.startedAt).getTime()) / 60000;
  }, [primary, now]);

  const isRunaway = runawayMinutes > settings.runawayThreshold;

  if (!fieldMode) {
    // h-[100dvh], not min-h-screen: the board's h-full needs a definite height
    // on this ancestor or it collapses to content height and the footer floats
    // mid-page.
    return (
      <div className="h-[100dvh] flex flex-col bg-bg">
        <header className="flex items-center gap-4 px-5 h-14 border-b border-edge shrink-0">
          <span className="font-bold tracking-tight text-lg">MasterDash</span>
          <nav className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <Link
                key={v.href}
                href={v.href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pathname === v.href
                    ? "bg-surface2 text-ink"
                    : "text-muted hover:text-ink hover:bg-surface"
                }`}
              >
                <Icon name={v.icon} size={16} />
                {v.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <RunningPill
              primary={primary}
              elapsed={elapsed}
              count={running.length}
              isRunaway={isRunaway}
            />
            {running.length > 0 && (
              <button
                onClick={() => stopAll()}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface2 border border-edge text-sm font-medium hover:bg-edge"
              >
                <Icon name="stop" size={14} filled />
                Stop
              </button>
            )}
            <span className="text-sm text-muted tabular-nums">{clock}</span>
          </div>
        </header>
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-screen bg-black flex flex-col md-safe overflow-hidden">
      {/* Top bezel — status only, never controls. Thumbs cannot reach here. */}
      <header className="h-14 shrink-0 flex items-center px-5 gap-4">
        <span className="font-bold tracking-tight text-base">MasterDash</span>
        <RunningPill
          primary={primary}
          elapsed={elapsed}
          count={running.length}
          isRunaway={isRunaway}
        />
        <span className="ml-auto text-sm text-muted tabular-nums">{clock}</span>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Left thumb gutter — view switching */}
        <nav className="w-[88px] shrink-0 flex flex-col items-center justify-center gap-3">
          {VIEWS.map((v) => (
            <Link
              key={v.href}
              href={v.href}
              aria-label={v.label}
              aria-current={pathname === v.href ? "page" : undefined}
              className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform ${
                pathname === v.href
                  ? "bg-surface2 text-ink"
                  : "text-muted active:bg-surface"
              }`}
            >
              <Icon name={v.icon} size={22} />
              <span className="text-[9px] font-medium tracking-wide">
                {v.label}
              </span>
            </Link>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 min-h-0 rounded-2xl bg-surface overflow-hidden">
          {children}
        </div>

        {/* Right thumb gutter — context and stop */}
        <nav className="w-[88px] shrink-0 flex flex-col items-center justify-center gap-3">
          <button
            onClick={() => setShowContexts(true)}
            aria-label="Context filter"
            className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform ${
              settings.activeContext
                ? "bg-accent/15 text-accent"
                : "text-muted active:bg-surface"
            }`}
          >
            <Icon name="filter" size={22} />
            <span className="text-[9px] font-medium tracking-wide truncate max-w-14">
              {settings.activeContext ?? "All"}
            </span>
          </button>

          <button
            onClick={() => stopAll()}
            disabled={running.length === 0}
            aria-label="Stop all running activities"
            className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform ${
              running.length > 0
                ? "bg-red-500/15 text-red-400 active:bg-red-500/25"
                : "text-edge"
            }`}
          >
            <Icon name="stop" size={22} filled={running.length > 0} />
            <span className="text-[9px] font-medium tracking-wide">Stop</span>
          </button>
        </nav>
      </div>

      {showContexts && (
        <ContextSheet
          settings={settings}
          onClose={() => setShowContexts(false)}
        />
      )}
    </div>
  );
}

function RunningPill({
  primary,
  elapsed,
  count,
  isRunaway,
}: {
  primary?: { label: string; color: string; glyph: string };
  elapsed: string | null;
  count: number;
  isRunaway: boolean;
}) {
  if (!primary) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted">
        <span className="w-2 h-2 rounded-full bg-edge" />
        Off the clock
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <span
        className="w-2 h-2 rounded-full md-live-dot shrink-0"
        style={{ background: primary.color }}
      />
      <span className="text-sm font-medium truncate">
        {primary.glyph} {primary.label}
      </span>
      <span
        className={`text-sm tabular-nums font-semibold ${
          isRunaway ? "text-amber-400" : "text-ink"
        }`}
        title={isRunaway ? "Running unusually long — check this entry" : undefined}
      >
        {elapsed}
      </span>
      {count > 1 && (
        <span className="text-xs text-muted">+{count - 1}</span>
      )}
    </span>
  );
}

function ContextSheet({
  settings,
  onClose,
}: {
  settings: Settings;
  onClose: () => void;
}) {
  const choose = (ctx: string | null) => {
    saveSettings({ activeContext: ctx });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-3xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Context</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-muted active:bg-surface2"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <ContextButton
            label="All tiles"
            active={settings.activeContext === null}
            onClick={() => choose(null)}
          />
          {settings.contexts.map((ctx) => (
            <ContextButton
              key={ctx}
              label={ctx}
              active={settings.activeContext === ctx}
              onClick={() => choose(ctx)}
            />
          ))}
        </div>
        <p className="mt-4 text-xs text-muted leading-relaxed">
          Tiles outside the chosen context dim but stay tappable, so a wrong
          context never locks you out in the field.
        </p>
      </div>
    </div>
  );
}

function ContextButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-14 px-5 rounded-2xl text-left font-medium flex items-center justify-between active:scale-[0.98] transition-transform ${
        active
          ? "bg-accent/15 text-accent border border-accent/30"
          : "bg-surface2 text-ink border border-edge"
      }`}
    >
      {label}
      {active && <Icon name="check" size={20} />}
    </button>
  );
}

function useClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}
