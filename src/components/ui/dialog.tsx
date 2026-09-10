"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 dark:bg-black/50 supports-backdrop-filter:backdrop-blur-xs",
        // The same backdrop treatment as `SheetOverlay` — one fade for every
        // overlay in the app. A plain duration, never a spring: opacity clips
        // outside 0..1 (docs/DESIGN.md §4).
        "duration-(--dur-base) ease-out-soft motion-reduce:animate-none",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  overlayClassName,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** Overrides on the backdrop — same escape hatch `SheetContent` already
   * exposes. Overdrive uses it to drop the blur so the board stays legible
   * behind it (`overdrive-overlay.tsx`). */
  overlayClassName?: string
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // `rounded-3xl` + `p-5`: concentric with the inner controls'
          // `--radius-md` (buttons, inputs) — outer radius = inner radius +
          // padding is what makes nested corners look drawn by the same hand
          // instead of picked from a component library's default scale.
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-3xl bg-popover p-5 text-sm text-popover-foreground shadow-(--shadow-overlay) ring-1 ring-foreground/10 outline-none sm:max-w-sm",
          /*
            A dialog arrives differently depending on how much of the screen it
            is taking. Under 640px (`resolveLayout()`'s phone cut) it is most of
            the window, so it rises from below like a sheet. Above that it is a
            small card in a large window, and travelling up from the bottom
            edge of a 1440px display would be a long journey to a place it does
            not belong — so it scales and fades where it lands.

            THE POSITIONING ABOVE IS DELIBERATELY UNTOUCHED. Consumers override
            that centering UNPREFIXED — `command.tsx` has `top-20
            translate-y-0`, `overdrive-overlay.tsx` has `translate-x-0
            translate-y-0` plus its own `tall:` centering. Moving the base
            centering into `sm:` would put it behind a media query those
            unprefixed overrides can no longer beat, and the palette would
            silently mis-place itself above 640px. Same trap as
            `.ai/lessons.md` on shorthand versus per-axis forms: a caller
            cannot narrow what the base states at a different granularity.

            So the motion is a keyframe animation, which composes its own
            transform rather than replacing the layout's.
          */
          "duration-(--dur-overlay) ease-spring-overlay",
          "data-open:animate-in data-closed:animate-out",
          "data-closed:duration-(--dur-overlay-exit) data-closed:ease-out-soft",
          "motion-reduce:animate-none",
          // Phone: rises by its own height. `slide-*` composes into the
          // keyframe's own translate, so it stacks on the centering above
          // rather than fighting it.
          "max-sm:data-open:slide-in-from-bottom-full max-sm:data-closed:slide-out-to-bottom-full",
          // Desktop: scales in place. The same 0.95 as before, but on the
          // spring over --dur-overlay instead of flat over 100ms — which is
          // the whole difference between landing and appearing.
          "sm:data-open:zoom-in-95 sm:data-open:fade-in-0",
          "sm:data-closed:zoom-out-95 sm:data-closed:fade-out-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // A hairline, not a filled bar — `bg-muted/50` was the one solid
        // panel-within-a-panel left in the app after the Air pass retired
        // every other filled surface.
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-line-faint p-5 pt-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // A real heading step, not a label wearing a heading's font — this was
      // `text-base font-medium`, which the serif `font-heading` face barely
      // distinguishes from body text at all.
      className={cn(
        "font-heading text-lg leading-tight font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
