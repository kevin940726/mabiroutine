import { useEffect, useState } from "react";
import { formatCountdown, getNextDailyReset, getNextWeeklyReset } from "@/lib/reset";

export function useCountdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const daily = getNextDailyReset(now);
  const weekly = getNextWeeklyReset(now);
  return {
    now,
    dailyMs: daily.getTime() - now.getTime(),
    weeklyMs: weekly.getTime() - now.getTime(),
    dailyText: formatCountdown(daily.getTime() - now.getTime()),
    weeklyText: formatCountdown(weekly.getTime() - now.getTime()),
  };
}
