import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

// Shared hint tooltip. Radix-powered: the content portals to the body, so it
// escapes overflow-hidden ancestors (section Cards) and flips at viewport
// edges — the previous hand-rolled absolute bubble was clipped by both.
export function Tooltip({
  content,
  children,
  className,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className="inline-flex items-center">{children}</span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              "z-50 max-w-[min(280px,80vw)] break-words rounded-md bg-foreground px-2.5 py-1 text-xs text-background shadow-md",
              className
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-foreground" width={11} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
