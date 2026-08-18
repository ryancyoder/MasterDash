"use client";

import { useState } from "react";
import { Activity, Entry } from "@/lib/types";
import {
  entryMinutes,
  formatClock,
  formatDurationLong,
  toTimeInput,
  withTime,
} from "@/lib/time";
import { removeEntry, splitEntry, updateEntry } from "@/lib/store";
import Icon from "./Icon";

/**
 * The detail sheet behind a long press. Every destructive or fiddly action
 * lives here so the board itself stays a surface where nothing can go wrong.
 */
export default function EntrySheet({
  entry,
  activity,
  onClose,
}: {
  entry: Entry;
  activity: Activity | undefined;
  onClose: () => void;
}) {
  const [start, setStart] = useState(toTimeInput(entry.startedAt));
  const [end, setEnd] = useState(
    entry.endedAt ? toTimeInput(entry.endedAt) : "",
  );
  const [note, setNote] = useState(entry.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const minutes = entryMinutes(entry);

  const save = () => {
    const patch: Partial<Entry> = {
      startedAt: withTime(entry.startedAt, start),
      note: note.trim() || undefined,
    };
    if (end) {
      patch.endedAt = withTime(entry.endedAt ?? entry.startedAt, end);
    }
    // A backwards span is almost always a night shift crossing midnight.
    if (patch.endedAt && patch.endedAt < (patch.startedAt as string)) {
      const d = new Date(patch.endedAt);
      d.setDate(d.getDate() + 1);
      patch.endedAt = d.toISOString();
    }
    updateEntry(entry.id, patch);
    onClose();
  };

  return (
    <Sheet onClose={onClose} title={activity?.label ?? "Entry"}>
      <div className="flex items-center gap-3 mb-6">
        <span
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
          style={{ background: activity?.color ?? "#78716c" }}
        >
          {activity?.glyph ?? "•"}
        </span>
        <div className="min-w-0">
          <div className="font-semibold truncate">
            {activity?.label ?? "Unknown activity"}
          </div>
          <div className="text-sm text-muted">
            {formatDurationLong(minutes)}
            {!entry.endedAt && " · running"}
            {entry.source === "edited" && " · edited"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="Start">
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full h-14 px-4 rounded-xl bg-surface2 border border-edge text-lg tabular-nums"
          />
        </Field>
        <Field label={entry.endedAt ? "End" : "End (leave blank to keep running)"}>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full h-14 px-4 rounded-xl bg-surface2 border border-edge text-lg tabular-nums"
          />
        </Field>
      </div>

      <Field label="Note">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What happened?"
          className="w-full px-4 py-3 rounded-xl bg-surface2 border border-edge resize-none"
        />
      </Field>

      <div className="flex gap-3 mt-6">
        <button
          onClick={save}
          className="flex-1 h-14 rounded-2xl bg-accent text-black font-semibold text-base active:scale-[0.98] transition-transform"
        >
          Save
        </button>
        {minutes > 2 && (
          <button
            onClick={() => {
              const mid = new Date(
                new Date(entry.startedAt).getTime() + (minutes / 2) * 60000,
              ).toISOString();
              splitEntry(entry.id, mid);
              onClose();
            }}
            aria-label="Split entry in half"
            className="w-14 h-14 rounded-2xl bg-surface2 border border-edge flex items-center justify-center active:scale-95 transition-transform"
          >
            <Icon name="scissors" size={20} />
          </button>
        )}
        <button
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            removeEntry(entry.id);
            onClose();
          }}
          aria-label={confirmDelete ? "Confirm delete" : "Delete entry"}
          className={`h-14 rounded-2xl flex items-center justify-center gap-2 px-4 font-semibold active:scale-95 transition-transform ${
            confirmDelete
              ? "bg-red-500 text-black"
              : "bg-surface2 border border-edge text-red-400"
          }`}
        >
          <Icon name="trash" size={20} />
          {confirmDelete && "Sure?"}
        </button>
      </div>

      <p className="mt-4 text-xs text-muted">
        Started {formatClock(entry.startedAt)}
        {entry.endedAt && ` · ended ${formatClock(entry.endedAt)}`}
      </p>
    </Sheet>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  dismissOnBackdrop = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned below the scroll area, so actions survive a long form. */
  footer?: React.ReactNode;
  /**
   * Forms pass false. A backdrop tap discarding a half-filled form is bad
   * anywhere, and worse on a tablet: with the on-screen keyboard up, the tap
   * that dismisses the keyboard often lands on the backdrop.
   */
  dismissOnBackdrop?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        className="bg-surface border border-edge rounded-3xl w-full max-w-lg max-h-[88dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-muted active:bg-surface2"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto md-scroll px-6">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 px-6 pt-4 pb-6 border-t border-edge bg-surface">
            {footer}
          </div>
        )}
        {!footer && <div className="shrink-0 h-6" />}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
