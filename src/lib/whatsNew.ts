import { useCallback, useMemo, useState } from "react";
import entriesJson from "@/data/whatsNew.generated.json";
import { useAppStore } from "@/store/useAppStore";

export type WhatsNewKind = "feature" | "fix";

/** One bullet. `release` is the marker text — the release's id — and `date` is
 *  the heading date (`YYYY-MM-DD`). */
export type WhatsNewEntry = {
  release: string;
  date: string;
  kind: WhatsNewKind;
  text: string;
};

/** One release: its marker as the id, its heading date, its bullets in file
 *  order. */
export type Release = {
  id: string;
  date: string;
  entries: WhatsNewEntry[];
};

export type DateGroup = {
  date: string;
  releases: Release[];
};

const ENTRIES = entriesJson as WhatsNewEntry[];

export function formatMd(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[2]}/${m[3]}` : date;
}

export function releasesOf(entries: readonly WhatsNewEntry[]): Release[] {
  const out: Release[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && last.id === entry.release) last.entries.push(entry);
    else out.push({ id: entry.release, date: entry.date, entries: [entry] });
  }
  return out;
}

export function groupByDate(releases: readonly Release[]): DateGroup[] {
  const out: DateGroup[] = [];
  for (const release of releases) {
    const last = out[out.length - 1];
    if (last && last.date === release.date) last.releases.push(release);
    else out.push({ date: release.date, releases: [release] });
  }
  return out;
}

/** How long an unacknowledged nudge survives: the feature release's Taipei day
 *  and the day after. The changelog is day-granular, so "a day" cannot mean 24
 *  hours from the release. */
export const DOT_WINDOW_DAYS = 1;

const TAIPEI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function taipeiDate(at: number | Date = Date.now()): string {
  return TAIPEI_DAY.format(at);
}

function daysBetween(date: string, today: string): number | null {
  const from = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const to = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!from || !to) return null;
  const a = Date.UTC(Number(from[1]), Number(from[2]) - 1, Number(from[3]));
  const b = Date.UTC(Number(to[1]), Number(to[2]) - 1, Number(to[3]));
  return (b - a) / 86_400_000;
}

/** The newest release that carries a feature: the only one the dot points at.
 *  A fixes-only release never nudges. */
export function newestFeatureRelease(releases: readonly Release[]): Release | null {
  return releases.find((r) => r.entries.some((e) => e.kind === "feature")) ?? null;
}

function nudgeBaseline(releases: readonly Release[], latest: Release | null): Release | null {
  return newestFeatureRelease(releases) ?? latest;
}

export function dotFor(releases: readonly Release[], today: string, nudged = ""): boolean {
  // No marker yet (a fresh save): no dot, because nothing has been missed. The
  // first menu open seeds the baseline.
  if (!nudged) return false;
  const newest = newestFeatureRelease(releases);
  if (!newest) return false;
  if (nudged === newest.id) return false;
  const age = daysBetween(newest.date, today);
  return age !== null && age <= DOT_WINDOW_DAYS;
}

export type WhatsNewView = {
  /** Every release, newest first, grouped by its heading date. */
  groups: DateGroup[];
};

export function useWhatsNew() {
  const releases = useMemo(() => releasesOf(ENTRIES), []);
  const view = useMemo<WhatsNewView>(() => ({ groups: groupByDate(releases) }), [releases]);
  const nudged = useAppStore((s) => s.whatsNewNudged);
  const setNudged = useAppStore((s) => s.setWhatsNewNudged);
  const [open, setOpen] = useState(false);
  const latest = releases[0] ?? null;

  const openDrawer = useCallback(() => setOpen(true), []);

  /** Opening the menu is enough to say "I saw the nudge"; the page itself
   *  stays available. The marker is synced, so the other device goes quiet. */
  const acknowledgeDot = useCallback(() => {
    const baseline = nudgeBaseline(releases, latest);
    if (!baseline || baseline.id === nudged) return;
    setNudged(baseline.id);
  }, [latest, nudged, releases, setNudged]);

  return {
    view,
    open,
    openDrawer,
    onOpenChange: setOpen,
    releases,
    nudged,
    label: latest ? `最新 · ${formatMd(latest.date)}` : "",
    acknowledgeDot,
  };
}
