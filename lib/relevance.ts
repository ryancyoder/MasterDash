import { Activity, Entry, Settings } from "./types";

/**
 * Contextual tile surfacing.
 *
 * Out-of-context tiles dim; they never disappear. A mis-scoped context should
 * degrade the board, not make it unusable in the field where you cannot stop to
 * fix settings.
 */

export interface Relevance {
  relevant: boolean;
  /** Higher sorts earlier when reordering is on. */
  score: number;
}

function withinTimeWindow(activity: Activity, now: Date): boolean {
  const { activeFrom, activeUntil } = activity;
  if (!activeFrom && !activeUntil) return true;

  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const from = activeFrom ? toMins(activeFrom) : 0;
  const until = activeUntil ? toMins(activeUntil) : 24 * 60;

  // A window that wraps midnight (22:00–02:00) is inclusive of both sides.
  if (from > until) return mins >= from || mins <= until;
  return mins >= from && mins <= until;
}

export function relevanceOf(
  activity: Activity,
  settings: Settings,
  entries: Entry[],
  now: Date = new Date(),
): Relevance {
  let relevant = true;

  if (activity.activeDays?.length && !activity.activeDays.includes(now.getDay())) {
    relevant = false;
  }
  if (!withinTimeWindow(activity, now)) {
    relevant = false;
  }
  if (
    settings.activeContext &&
    activity.contexts?.length &&
    !activity.contexts.includes(settings.activeContext)
  ) {
    relevant = false;
  }

  // Recency: tiles used in the last week rise, with the most recent highest.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let recency = 0;
  let frequency = 0;
  for (const e of entries) {
    if (e.activityId !== activity.id) continue;
    const t = new Date(e.startedAt).getTime();
    if (t < weekAgo) continue;
    frequency += 1;
    recency = Math.max(recency, t);
  }

  const recencyScore = recency ? (recency - weekAgo) / (7 * 24 * 60 * 60 * 1000) : 0;
  const score = (relevant ? 100 : 0) + recencyScore * 10 + Math.min(frequency, 10);

  return { relevant, score };
}

/** Board ordering: relevant tiles first, then the author's manual sort. */
export function orderForBoard(
  activities: Activity[],
  settings: Settings,
  entries: Entry[],
  now: Date = new Date(),
): { activity: Activity; relevant: boolean }[] {
  const scored = activities
    .filter((a) => !a.archived)
    .map((a) => ({ activity: a, ...relevanceOf(a, settings, entries, now) }));

  scored.sort((a, b) => {
    if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
    return a.activity.sort - b.activity.sort;
  });

  return scored.map(({ activity, relevant }) => ({ activity, relevant }));
}
