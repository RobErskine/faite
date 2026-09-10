"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 dark:bg-black/50 supports-backdrop-filter:backdrop-blur-xs",
        /*
          One backdrop treatment, shared with dialog and alert-dialog: a plain
          fade on `--dur-base`, no spring. Opacity clips outside 0..1, so a
          spring here would flicker rather than settle (docs/DESIGN.md §4).

          180ms against the panel's ~140ms arrival: the dimming is under way
          before the panel lands, so the two read as one event.
        */
        "duration-(--dur-base) ease-out-soft motion-reduce:animate-none",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  overlayClassName,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  overlayClassName?: string
}) {
  return (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-(--shadow-overlay)",
          /*
            The panel travels its OWN SIZE, not a nudge, and it does so on
            `data-open`/`data-closed` keyframes.

            Both halves of that were broken. It used to start `2.5rem` (40px)
            from where it lands — on the to-do sheet, measured at 680px wide,
            about 6% of its width. And it never even travelled that far,
            because the whole thing was keyed on `data-starting-style` /
            `data-ending-style`, WHICH THIS PRIMITIVE DOES NOT EMIT. Measured,
            not assumed: sampling the live popup every frame from the moment it
            mounts, its only state attribute is `data-open` — the starting
            attribute never appears, and `translate` reads `0px` on frame one
            of what claimed to be a 340ms slide. So every one of those rules
            was dead CSS and the sheet simply appeared.

            `@base-ui/react/drawer` DOES support that API, which is the trap:
            `ui/drawer.tsx` is full of `data-starting-style` and is correct.
            This is `@base-ui/react/dialog`, where the vocabulary is
            `data-open` / `data-closed` — which is why dialogs animated and
            sheets never did.

            `*-full` is the element's own measure, so every side and every
            consumer width is right without a per-consumer number to maintain.

            Enter springs (`--ease-spring-overlay`, 1.6% overshoot, 95% arrived
            by ~140ms); exit is shorter and unsprung — nobody is waiting to
            admire an overlay leaving. docs/DESIGN.md §4.

            THE EXIT HALF DOES NOT CURRENTLY RENDER, and the rules below are
            kept deliberately rather than in hope. Measured: on close this
            primitive unmounts the popup ~21ms after `data-closed` lands, which
            is before the browser starts the animation, so the panel vanishes.
            `<Portal keepMounted>` is not the fix — it keeps the node but marks
            it `hidden`, and preflight's `[hidden] { display: none !important }`
            means the animation is assigned and never painted (`animationName`
            reads `exit` while `transform` stays `none`).

            Left in place because they are correct and cost nothing the moment
            the unmount is sequenced behind the animation; that needs
            `Dialog.Root`'s completion callback and is EI-317's follow-up, not
            a class change. Do not read their presence as "exits are handled".
          */
          "duration-(--dur-overlay) ease-spring-overlay",
          "data-open:animate-in data-closed:animate-out",
          "data-closed:duration-(--dur-overlay-exit) data-closed:ease-out-soft",
          // Reduced motion keeps the overlay and drops the journey. Position is
          // layout, not animation, so it stays correct with the motion removed.
          "motion-reduce:animate-none",
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t",
          "data-[side=bottom]:data-open:slide-in-from-bottom-full data-[side=bottom]:data-closed:slide-out-to-bottom-full",
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b",
          "data-[side=top]:data-open:slide-in-from-top-full data-[side=top]:data-closed:slide-out-to-top-full",
          "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:sm:max-w-sm",
          "data-[side=left]:data-open:slide-in-from-left-full data-[side=left]:data-closed:slide-out-to-left-full",
          "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:sm:max-w-sm",
          "data-[side=right]:data-open:slide-in-from-right-full data-[side=right]:data-closed:slide-out-to-right-full",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 p-5", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex flex-col gap-2 border-t border-line-faint p-5",
        className
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      // Matches DialogTitle's step up from a label-sized default — see its
      // comment.
      className={cn(
        "font-heading text-lg leading-tight font-semibold tracking-tight text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
