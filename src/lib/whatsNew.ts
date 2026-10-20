import { useCallback, useMemo, useState } from "react";
import entriesJson from "@/data/whatsNew.generated.json";

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

const SEEN_KEY = "mabiroutine:whatsnew-seen";

const ENTRIES = entriesJson as WhatsNewEntry[];

export function formatMd(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[2]}/${m[3]}` : date;
}

export function markerDate(marker: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(marker);
  return m ? m[1] : null;
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

export function readSeen(): string | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function writeSeen(release: string): void {
  try {
    localStorage.setItem(SEEN_KEY, release);
  } catch {
    // Private mode: the marker lasts this visit.
  }
}

export function latestRelease(): Release | null {
  return releasesOf(ENTRIES)[0] ?? null;
}

export type WhatsNewSummary = {
  /** A first visit (no marker), releases newer than the marker, or caught up. */
  state: "first" | "unread" | "read";
  /** Newer than the marker. Empty unless `state === "unread"`. */
  unread: Release[];
  /** Every release, newest first. */
  releases: Release[];
  /** The menu row's status text. */
  label: string;
};

export function summaryFor(seen: string | null, entries: readonly WhatsNewEntry[] = ENTRIES): WhatsNewSummary {
  const releases = releasesOf(entries);
  const latest = releases[0];

  if (!latest) return { state: "read", unread: [], releases, label: "已讀到最新" };

  const firstRun = (): WhatsNewSummary => ({
    state: "first",
    unread: [],
    releases,
    label: `最新 · ${formatMd(latest.date)}`,
  });

  if (seen === null) return firstRun();

  const at = releases.findIndex((r) => r.id === seen);
  let unread: Release[];
  if (at >= 0) {
    unread = releases.slice(0, at);
  } else {
    const date = markerDate(seen);
    if (!date) return firstRun();
    unread = releases.filter((r) => r.date >= date);
  }

  if (!unread.length) return { state: "read", unread, releases, label: "已讀到最新" };
  return {
    state: "unread",
    unread,
    releases,
    label: `${formatMd(unread[0].date)} · ${unread.length} 則未讀`,
  };
}

export const DOT_WINDOW_DAYS = 14;

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

export function dotFor(summary: WhatsNewSummary, today: string): boolean {
  if (summary.state !== "unread") return false;
  const newest = summary.unread[0];
  if (!newest) return false;
  if (!summary.unread.some((r) => r.entries.some((e) => e.kind === "feature"))) return false;
  const age = daysBetween(newest.date, today);
  return age !== null && age <= DOT_WINDOW_DAYS;
}

export type WhatsNewView = {
  /** Date groups, newest first; each release keeps its own bullets. */
  groups: DateGroup[];
  /** Whether to print the caught-up line and the archive link. */
  caughtUp: boolean;
};

export function viewFor(summary: WhatsNewSummary): WhatsNewView {
  const shown = summary.state === "unread" ? summary.unread : summary.releases.slice(0, 1);
  return { groups: groupByDate(shown), caughtUp: summary.state === "read" };
}

export function useWhatsNew() {
  const [seen, setSeen] = useState<string | null>(readSeen);
  const summary = useMemo(() => summaryFor(seen), [seen]);
  const [view, setView] = useState<WhatsNewView>(() => viewFor(summaryFor(readSeen())));
  const [open, setOpen] = useState(false);

  const openDrawer = useCallback(() => {
    setView(viewFor(summaryFor(readSeen())));
    setOpen(true);
    const latest = latestRelease();
    if (!latest) return;
    writeSeen(latest.id);
    setSeen(latest.id);
  }, []);

  return { summary, view, open, openDrawer, onOpenChange: setOpen };
}
