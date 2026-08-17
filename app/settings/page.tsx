"use client";

import { useRef, useState } from "react";
import Shell from "@/components/Shell";
import Icon from "@/components/Icon";
import { Sheet, Field } from "@/components/EntrySheet";
import {
  Activity,
  Entry,
  LOG_MODES,
  LogMode,
  Settings,
  TILE_COLORS,
} from "@/lib/types";
import {
  addActivity,
  Backup,
  exportBackup,
  importBackup,
  removeActivity,
  saveSettings,
  updateActivity,
} from "@/lib/store";
import { dateKey } from "@/lib/time";
import { downloadFile, readFileAsText } from "@/lib/download";

export default function SettingsPage() {
  return (
    <Shell>
      {({ activities, entries, settings }) => (
        <SettingsView
          activities={activities}
          entries={entries}
          settings={settings}
        />
      )}
    </Shell>
  );
}

function SettingsView({
  activities,
  entries,
  settings,
}: {
  activities: Activity[];
  entries: Entry[];
  settings: Settings;
}) {
  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const visible = activities.filter((a) => !a.archived);
  const archived = activities.filter((a) => a.archived);

  const doExport = () => {
    downloadFile(
      JSON.stringify(exportBackup(), null, 2),
      `masterdash-backup-${dateKey()}.json`,
      "application/json",
    );
  };

  const doImport = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const backup = JSON.parse(text) as Backup;
      const mode = window.confirm(
        "Replace everything with this backup?\n\nOK = replace all data.\nCancel = merge, keeping what you already have.",
      )
        ? "replace"
        : "merge";
      importBackup(backup, mode);
      setStatus(`Imported ${backup.entries.length} entries.`);
    } catch (err) {
      setStatus(
        `Import failed: ${err instanceof Error ? err.message : "unreadable file"}`,
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto md-scroll">
      <div className="max-w-3xl mx-auto p-5 pb-16">
        <Section title="Tiles" subtitle={`${visible.length} active`}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {visible.map((a) => (
              <button
                key={a.id}
                onClick={() => setEditing(a)}
                className="h-20 rounded-2xl px-3 flex items-center gap-2.5 bg-surface2 border border-edge text-left active:scale-[0.98] transition-transform"
              >
                <span
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                  style={{ background: a.color }}
                >
                  {a.glyph}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-sm truncate">
                    {a.label}
                  </span>
                  <span className="block text-[11px] text-muted capitalize">
                    {a.logMode}
                    {a.group && ` · ${a.group}`}
                  </span>
                </span>
              </button>
            ))}
            <button
              onClick={() => setEditing("new")}
              className="h-20 rounded-2xl flex items-center justify-center gap-2 border-2 border-dashed border-edge text-muted active:scale-[0.98] transition-transform"
            >
              <Icon name="plus" size={20} />
              <span className="text-sm font-medium">New tile</span>
            </button>
          </div>

          {archived.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted mb-2">
                {archived.length} archived — kept because they have logged time.
              </p>
              <div className="flex flex-wrap gap-2">
                {archived.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => updateActivity(a.id, { archived: false })}
                    className="h-10 px-3 rounded-xl bg-surface2 border border-edge text-sm text-muted"
                  >
                    {a.glyph} {a.label} · restore
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>

        <Section title="Display">
          <Row
            label="View mode"
            hint="Field adds the black thumb frame. Browser is denser for desktop."
          >
            <div className="flex rounded-xl bg-surface2 p-1">
              {(["auto", "field", "browser"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => saveSettings({ viewMode: m })}
                  className={`h-10 px-4 rounded-lg text-sm font-medium capitalize ${
                    settings.viewMode === m ? "bg-edge text-ink" : "text-muted"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Row>

          <Row
            label="Dim out-of-context tiles"
            hint="Off means every tile stays at full brightness."
          >
            <Toggle
              on={settings.dimOutOfContext}
              onChange={(v) => saveSettings({ dimOutOfContext: v })}
            />
          </Row>

          <Row
            label="Long-run warning"
            hint="Highlights the timer once an entry runs past this many hours."
          >
            <input
              type="number"
              min={1}
              max={24}
              value={Math.round(settings.runawayThreshold / 60)}
              onChange={(e) =>
                saveSettings({
                  runawayThreshold: Math.max(1, Number(e.target.value)) * 60,
                })
              }
              className="w-24 h-11 px-3 rounded-xl bg-surface2 border border-edge tabular-nums"
            />
          </Row>
        </Section>

        <Section title="Contexts" subtitle="Filter the board by where you are">
          <ContextEditor settings={settings} />
        </Section>

        <Section
          title="Backup"
          subtitle={`${entries.length} entries stored on this device`}
        >
          <p className="text-sm text-muted mb-3 leading-relaxed">
            Everything lives in this browser only. Nothing syncs, and clearing
            site data erases it — export regularly.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={doExport}
              className="h-12 px-5 rounded-xl bg-accent text-black font-semibold"
            >
              Export backup
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="h-12 px-5 rounded-xl bg-surface2 border border-edge font-medium"
            >
              Import backup
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
                e.target.value = "";
              }}
            />
          </div>
          {status && <p className="mt-3 text-sm text-accent">{status}</p>}
        </Section>
      </div>

      {editing && (
        <ActivityEditor
          activity={editing === "new" ? null : editing}
          contexts={settings.contexts}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ActivityEditor({
  activity,
  contexts,
  onClose,
}: {
  activity: Activity | null;
  contexts: string[];
  onClose: () => void;
}) {
  const [label, setLabel] = useState(activity?.label ?? "");
  const [glyph, setGlyph] = useState(activity?.glyph ?? "⭐");
  const [color, setColor] = useState(activity?.color ?? TILE_COLORS[4]);
  const [group, setGroup] = useState(activity?.group ?? "");
  const [logMode, setLogMode] = useState<LogMode>(activity?.logMode ?? "punch");
  const [duration, setDuration] = useState(activity?.defaultDuration ?? 15);
  const [billable, setBillable] = useState(activity?.billable ?? false);
  const [selected, setSelected] = useState<string[]>(activity?.contexts ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const data = {
      label: trimmed,
      glyph: glyph.trim() || "⭐",
      color,
      group: group.trim() || undefined,
      logMode,
      defaultDuration: logMode === "instant" ? duration : undefined,
      billable,
      contexts: selected.length ? selected : undefined,
    };
    if (activity) updateActivity(activity.id, data);
    else addActivity(data);
    onClose();
  };

  return (
    <Sheet title={activity ? "Edit tile" : "New tile"} onClose={onClose}>
      <div className="flex gap-3 mb-4">
        <div className="shrink-0">
          <span className="block text-xs font-medium text-muted mb-1.5">
            Glyph
          </span>
          <input
            value={glyph}
            onChange={(e) => setGlyph(e.target.value.slice(0, 2))}
            className="w-20 h-14 rounded-xl bg-surface2 border border-edge text-center text-2xl"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Install"
              autoFocus
              className="w-full h-14 px-4 rounded-xl bg-surface2 border border-edge text-lg"
            />
          </Field>
        </div>
      </div>

      <Field label="Colour">
        <div className="flex flex-wrap gap-2">
          {TILE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              className={`w-11 h-11 rounded-xl transition-transform ${
                color === c ? "ring-2 ring-white scale-110" : ""
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      <div className="mt-4">
        <Field label="Tap behaviour">
          <div className="flex flex-col gap-2">
            {LOG_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setLogMode(m.key)}
                className={`p-3 rounded-xl text-left border ${
                  logMode === m.key
                    ? "bg-accent/10 border-accent/40"
                    : "bg-surface2 border-edge"
                }`}
              >
                <span className="block font-medium text-sm">{m.label}</span>
                <span className="block text-xs text-muted mt-0.5">
                  {m.hint}
                </span>
              </button>
            ))}
          </div>
        </Field>
      </div>

      {logMode === "instant" && (
        <div className="mt-4">
          <Field label="Block length (minutes)">
            <input
              type="number"
              min={1}
              max={480}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
              className="w-32 h-12 px-3 rounded-xl bg-surface2 border border-edge tabular-nums"
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Field label="Group">
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Field"
            className="w-full h-12 px-4 rounded-xl bg-surface2 border border-edge"
          />
        </Field>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-3">
            <Toggle on={billable} onChange={setBillable} />
            <span className="text-sm font-medium">Billable</span>
          </label>
        </div>
      </div>

      {contexts.length > 0 && (
        <div className="mt-4">
          <Field label="Show in contexts (none = always)">
            <div className="flex flex-wrap gap-2">
              {contexts.map((ctx) => {
                const on = selected.includes(ctx);
                return (
                  <button
                    key={ctx}
                    onClick={() =>
                      setSelected(
                        on
                          ? selected.filter((c) => c !== ctx)
                          : [...selected, ctx],
                      )
                    }
                    className={`h-11 px-4 rounded-xl text-sm font-medium border ${
                      on
                        ? "bg-accent/15 text-accent border-accent/30"
                        : "bg-surface2 text-muted border-edge"
                    }`}
                  >
                    {ctx}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          onClick={save}
          disabled={!label.trim()}
          className="flex-1 h-14 rounded-2xl bg-accent text-black font-semibold disabled:opacity-40"
        >
          {activity ? "Save" : "Create tile"}
        </button>
        {activity && (
          <button
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              removeActivity(activity.id);
              onClose();
            }}
            className={`h-14 px-5 rounded-2xl flex items-center gap-2 font-semibold ${
              confirmDelete
                ? "bg-red-500 text-black"
                : "bg-surface2 border border-edge text-red-400"
            }`}
          >
            <Icon name="trash" size={20} />
            {confirmDelete && "Sure?"}
          </button>
        )}
      </div>
      {activity && (
        <p className="mt-3 text-xs text-muted">
          Tiles with logged time are archived rather than deleted, so past
          totals stay correct.
        </p>
      )}
    </Sheet>
  );
}

function ContextEditor({ settings }: { settings: Settings }) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const name = draft.trim();
    if (!name || settings.contexts.includes(name)) return;
    saveSettings({ contexts: [...settings.contexts, name] });
    setDraft("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {settings.contexts.map((ctx) => (
          <span
            key={ctx}
            className="h-11 pl-4 pr-2 rounded-xl bg-surface2 border border-edge flex items-center gap-2 text-sm"
          >
            {ctx}
            <button
              onClick={() =>
                saveSettings({
                  contexts: settings.contexts.filter((c) => c !== ctx),
                  activeContext:
                    settings.activeContext === ctx ? null : settings.activeContext,
                })
              }
              aria-label={`Remove ${ctx}`}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted"
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New context"
          className="flex-1 max-w-xs h-12 px-4 rounded-xl bg-surface2 border border-edge"
        />
        <button
          onClick={add}
          className="h-12 px-5 rounded-xl bg-surface2 border border-edge font-medium"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-9">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-edge/60">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{label}</div>
        {hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`w-14 h-8 rounded-full p-1 transition-colors ${
        on ? "bg-accent" : "bg-edge"
      }`}
    >
      <span
        className={`block w-6 h-6 rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : ""
        }`}
      />
    </button>
  );
}
