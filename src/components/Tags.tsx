import { Tooltip } from "@/components/ui/tooltip";
import { formatEventEnd } from "@/lib/events";

const tagBase = "rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0";

export function EventTag({ endTime }: { endTime: string }) {
  const label = `活動至 ${formatEventEnd(endTime)}`;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={`${tagBase} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200`}
      >
        活動
      </button>
    </Tooltip>
  );
}

export function WeekendTag() {
  return (
    <span className={`${tagBase} bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300`}>
      週末
    </span>
  );
}
