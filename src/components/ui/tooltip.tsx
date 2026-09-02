import * as React from "react";
import { cn } from "@/lib/utils";

export function Tooltip({ content, children, className }: { content: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 whitespace-nowrap rounded-md bg-foreground text-background px-2.5 py-1 text-xs shadow-md pointer-events-none",
            "after:absolute after:left-1/2 after:-translate-x-1/2 after:top-full after:border-4 after:border-transparent after:border-t-foreground",
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
