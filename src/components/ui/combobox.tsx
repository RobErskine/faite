"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Multi-select with a remembered value array — the shape a set of applied
 * `Label`s needs, and the base-ui.com docs' own guidance for when to reach
 * for this over `Autocomplete`: "Combobox is a filterable Select" for a
 * bounded set of items, with `multiple` + `Chips`/`Chip`/`ChipRemove` as the
 * first-class pattern for a tag input. `Autocomplete` was tried first for
 * `LabelPicker` and rejected — it hardcodes `fillInputOnItemPress`, so a pick
 * always overwrites the input with the item's name, fighting a picker meant
 * to clear itself and accumulate chips instead. `Combobox`'s `multiple` mode
 * clears the input on a pick by design (its `onInputValueChange` reports
 * `reason: "item-press"` for exactly this case), which is what makes it fit.
 */

// A plain alias, not a wrapper function — `Root` renders no element of its
// own and has generic overloads a hand-written signature would fight rather
// than forward, same reason `ui/autocomplete.tsx`/`ui/select.tsx` do this.
const Combobox = ComboboxPrimitive.Root

/** `useFilter` lives on the namespace import, not on `Root` — this re-export
 * is what makes it reachable from `Combobox` the way `Combobox.useFilter`
 * would read if `Combobox` above were the whole namespace. */
const useComboboxFilter = ComboboxPrimitive.useFilter

function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1 transition-colors has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

function ComboboxChip({ className, ...props }: ComboboxPrimitive.Chip.Props) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium leading-none",
        className
      )}
      {...props}
    />
  )
}

function ComboboxChipRemove({ className, ...props }: ComboboxPrimitive.ChipRemove.Props) {
  return (
    <ComboboxPrimitive.ChipRemove
      data-slot="combobox-chip-remove"
      className={cn(
        "rounded-full p-0.5 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      <XIcon className="size-2.5" aria-hidden />
    </ComboboxPrimitive.ChipRemove>
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-6 min-w-16 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm",
        className
      )}
      {...props}
    />
  )
}

function ComboboxPortal({ ...props }: ComboboxPrimitive.Portal.Props) {
  return <ComboboxPrimitive.Portal data-slot="combobox-portal" {...props} />
}

function ComboboxPositioner({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Positioner.Props) {
  return (
    <ComboboxPrimitive.Positioner
      data-slot="combobox-positioner"
      align={align}
      sideOffset={sideOffset}
      className={cn("isolate z-50 outline-hidden", className)}
      {...props}
    />
  )
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Popup
      data-slot="combobox-popup"
      className={cn(
        "z-50 max-h-72 w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-(--shadow-raised) ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

/**
 * Same reason `ui/autocomplete.tsx`'s `AutocompleteEmpty` must stay mounted:
 * without it, Escape on a query that matches nothing bubbles past this popup
 * and closes whatever it's nested in (a Sheet, a Dialog) instead of just the
 * popup.
 *
 * Base UI's own doc comment on this component is explicit that the ROOT
 * element must stay mounted regardless — only its `children` toggle to
 * `null` when there are matches. So `py-6` cannot be conditioned on "is this
 * actually empty" the normal way (a class prop, a wrapping `{empty && ...}`)
 * — it always renders, full box model, with nothing inside, which is what
 * left a blank ~48px band above every non-empty result list. `empty:hidden`
 * (the CSS `:empty` pseudo-class — zero child nodes) is what collapses it
 * exactly when `children` is `null`, without touching the element itself.
 */
function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("empty:hidden py-6 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxInput,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  useComboboxFilter,
}
