"use client"

import * as React from "react"
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Free text with optional selection — the shape `Todo.location` +
 * `Todo.placeId` needs, and exactly what Base UI's own guidance says to
 * reach for over Combobox: "Use Combobox instead of Autocomplete if the
 * selection should be remembered and the input value cannot be custom."
 * Here the input value IS the record (`location`); a selection only ever
 * fills it in.
 */

// A plain alias, not a wrapper function: `Root` renders no element of its own
// ("doesn't render its own HTML element" per its docs) and has two generic
// overloads (flat items vs. grouped) that a hand-written wrapper signature
// fights rather than forwards — same reason `select.tsx` aliases
// `SelectPrimitive.Root` directly instead of wrapping it.
const Autocomplete = AutocompletePrimitive.Root

/**
 * Matches an item's text against a query — `useFilter` lives on the
 * namespace import, not on `Root`, so this re-export is what makes it
 * reachable from `Autocomplete` the way `Autocomplete.useFilter` would read
 * if `Autocomplete` above were the whole namespace instead of just `Root`.
 */
const useAutocompleteFilter = AutocompletePrimitive.useFilter

function AutocompleteInput({
  className,
  ...props
}: AutocompletePrimitive.Input.Props) {
  return (
    <AutocompletePrimitive.Input
      data-slot="autocomplete-input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteClear({
  className,
  ...props
}: AutocompletePrimitive.Clear.Props) {
  return (
    <AutocompletePrimitive.Clear
      data-slot="autocomplete-clear"
      className={cn(
        "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      <XIcon className="size-3.5" aria-hidden />
    </AutocompletePrimitive.Clear>
  )
}

function AutocompletePortal({ ...props }: AutocompletePrimitive.Portal.Props) {
  return <AutocompletePrimitive.Portal data-slot="autocomplete-portal" {...props} />
}

function AutocompletePositioner({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: AutocompletePrimitive.Positioner.Props) {
  return (
    <AutocompletePrimitive.Positioner
      data-slot="autocomplete-positioner"
      align={align}
      sideOffset={sideOffset}
      className={cn("isolate z-50 outline-hidden", className)}
      {...props}
    />
  )
}

function AutocompletePopup({
  className,
  ...props
}: AutocompletePrimitive.Popup.Props) {
  return (
    <AutocompletePrimitive.Popup
      data-slot="autocomplete-popup"
      className={cn(
        "z-50 max-h-72 w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-(--shadow-raised) ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteList({
  className,
  ...props
}: AutocompletePrimitive.List.Props) {
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

/**
 * Requires `items` on the Root and must stay mounted rather than
 * conditionally rendered (Base UI's own constraint, for consistent
 * screen-reader announcements) — but there is a second, sharper reason not
 * to skip it here: without an `Empty` in the tree, Escape on a query that
 * matches nothing bubbles past this popup and closes whatever it's nested
 * in (a Sheet, a Dialog), rather than just closing the popup. See
 * `combobox/root/AriaCombobox.js`'s `escape-key` handling.
 *
 * Because the root element has to stay mounted even with matches (only its
 * `children` become `null` then), `py-6` alone left a blank ~48px band
 * above every non-empty result list — the div still renders full padding
 * with nothing inside it. `empty:hidden` (the CSS `:empty` pseudo-class)
 * collapses it exactly when `children` is `null`, without touching whether
 * the element itself is mounted.
 */
function AutocompleteEmpty({
  className,
  ...props
}: AutocompletePrimitive.Empty.Props) {
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      className={cn("empty:hidden py-6 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function AutocompleteGroup({
  className,
  ...props
}: AutocompletePrimitive.Group.Props) {
  return (
    <AutocompletePrimitive.Group
      data-slot="autocomplete-group"
      className={cn("overflow-hidden p-1 text-foreground", className)}
      {...props}
    />
  )
}

function AutocompleteGroupLabel({
  className,
  ...props
}: AutocompletePrimitive.GroupLabel.Props) {
  return (
    <AutocompletePrimitive.GroupLabel
      data-slot="autocomplete-group-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

/**
 * `data-highlighted`, not cmdk's `data-selected` — Autocomplete has no
 * persistent selection state (that's Combobox), only a keyboard/pointer
 * highlight over ephemeral suggestions.
 */
function AutocompleteItem({
  className,
  ...props
}: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  useAutocompleteFilter,
}
