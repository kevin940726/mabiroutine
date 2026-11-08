import { TAIPEI_TZ } from "@/lib/types";

const END_FORMAT = new Intl.DateTimeFormat("zh-TW", {
  timeZone: TAIPEI_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function isEventLive(endTime: string | undefined, now: number): boolean {
  if (!endTime) return true;
  const end = Date.parse(endTime);
  return !Number.isFinite(end) || end > now;
}

export function formatEventEnd(endTime: string): string {
  const d = new Date(endTime);
  return Number.isFinite(d.getTime()) ? END_FORMAT.format(d) : endTime;
}
