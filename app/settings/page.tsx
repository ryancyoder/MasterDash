"use client";

import { useRef, useState } from "react";
import Shell from "@/components/Shell";
import Icon from "@/components/Icon";
import Link from "next/link";
import { Toggle } from "@/components/ActivityEditor";
import { Activity, Entry, Settings } from "@/lib/types";
import {
  Backup,
  exportBackup,
  importBackup,
  saveSettings,
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
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);


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
        <Section
          title="Tiles"
          subtitle={`${activities.filter((a) => !a.archived).length} active`}
        >
          <p className="text-sm text-muted mb-3 leading-relaxed">
            Tiles are created, nested and edited in the table view.
          </p>
          <Link
            href="/tiles"
            className="h-12 px-5 rounded-xl bg-surface2 border border-edge font-medium inline-flex items-center gap-2"
          >
            <Icon name="table" size={18} />
            Open tiles table
          </Link>
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
    </div>
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

