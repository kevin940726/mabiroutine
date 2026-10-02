import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A bottom sheet, built on the same Radix Dialog the app already uses for its
 * modals — no new dependency, and it inherits the focus trap, Escape handling,
 * scroll lock and `aria-modal` semantics that a hand-rolled panel would have to
 * re-earn.
 *
 * Why a drawer rather than an anchored dropdown: an anchored popup is positioned
 * against its trigger and sized from it (`min-w-[var(--radix-dropdown-menu-trigger-width)]`
 * in MenuSelect). The pill's filter trigger is deliberately narrow, so anchoring
 * would either cramp the option list or force the trigger wide again — the exact
 * coupling that broke when the browser font size grew. A drawer takes the whole
 * viewport width, so the option list is never bounded by the control that opened
 * it, and it sits at the bottom where a thumb already is.
 */
const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;
const DrawerPortal = DialogPrimitive.Portal;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-drawer="overlay"
    className={cn("fixed inset-0 z-50 bg-black/50 backdrop-blur-sm", className)}
    {...props}
  />
));
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  // Portal, not a nested fixed div: an ancestor with filter/backdrop-filter (the
  // sticky blurred header) becomes the containing block for fixed overlays, and
  // the pill's own wrapper is exactly that kind of ancestor.
  <DrawerPortal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-drawer="content"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85svh] w-full max-w-2xl flex-col gap-3 rounded-t-2xl border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg",
        className
      )}
      {...props}
    >
      {/* Grab handle: a phone idiom, and a second, larger hint that this is a sheet. */}
      <div className="mx-auto h-1.5 w-10 shrink-0 rounded-full bg-muted" aria-hidden="true" />
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 focus:outline-none">
        <X className="h-4 w-4" />
        <span className="sr-only">關閉</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = DialogPrimitive.Content.displayName;

function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 text-left", className)} {...props} />;
}

function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold leading-none", className)} {...props} />
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerPortal,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
