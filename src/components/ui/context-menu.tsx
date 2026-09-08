"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

import { cn } from "@/lib/utils"
import { useMenuOpenRegistration } from "@/lib/menu-open-store"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

/**
 * Right-click / long-press menus (EI-282), styled to match `dropdown-menu.tsx`
 * part for part — the two are one family and should read as one.
 *
 * Four deliberate differences from that file, all of them consequences of the
 * anchor being a point rather than an element:
 *
 * 1. No `w-(--anchor-width)` on the popup. A context menu's anchor is a
 *    synthetic `DOMRect` of width 0 for a mouse (10 for touch), so inheriting
 *    the dropdown's anchor-width rule renders a zero-width popup — which looks
 *    like "the menu never opened", not like a sizing bug. `min-w-44` instead.
 * 2. `ContextMenuSeparator` types against the generic `Separator`, which is
 *    what `ContextMenu` re-exports; it is not `Menu.Separator` and its props
 *    differ.
 * 3. The positioner opens below-and-right of the cursor rather than aligned to
 *    a trigger box.
 * 4. `ContextMenusEnabled` — app policy about WHERE these are allowed, which
 *    the primitive has no opinion about. See below.
 */

/**
 * Whether context menus may open in this subtree. Default true, so the
 * primitive behaves normally anywhere; `board.tsx` sets it to `!coarse`.
 *
 * The board turns them off on touch-primary devices because long-press is
 * already taken: dnd-kit's coarse `TouchSensor` lifts a card at 400ms and Base
 * UI's `LONG_PRESS_DELAY` is a hardcoded 500ms with no prop, and Base UI
 * clears its timer only on a >10px `touchmove` — never on drag activation. So
 * a still finger would get both a lifted card and a menu over it, and no
 * retune fixes that, it only decides which of the two breaks. docs/GESTURES.md
 * has the full argument; the phone's counterpart is MOBILE.md's M4 row sheet.
 *
 * A React context rather than each root calling `useViewport()`: that hook
 * subscribes a resize listener plus two matchMedia listeners PER CALL SITE,
 * and there is one root per card. `board.tsx` already has `coarse` in hand.
 */
const ContextMenusEnabledContext = React.createContext(true)

function ContextMenusEnabled({
  value,
  children,
}: {
  value: boolean
  children: React.ReactNode
}) {
  return (
    <ContextMenusEnabledContext.Provider value={value}>
      {children}
    </ContextMenusEnabledContext.Provider>
  )
}

/**
 * No `data-slot` here, unlike `DropdownMenu` — the root renders no DOM, so the
 * attribute would have nowhere to land.
 *
 * `disabled` is honored by the primitive in both `handleContextMenu` and
 * `handleTouchStart`, so one flag closes off right-click and long-press
 * together and callers never have to think about the two paths separately.
 */
function ContextMenu({
  disabled,
  onOpenChange,
  ...props
}: ContextMenuPrimitive.Root.Props) {
  const enabled = React.useContext(ContextMenusEnabledContext)
  /*
    Every context menu reports itself to the open store, so `computeModalOpen`
    can hold board hotkeys off without a callback prop on every card. Done here
    rather than at each call site precisely so a menu added later cannot forget
    — see `menu-open-store.ts` for why ⌘Z behind an open menu is the failure
    that matters.
  */
  const register = useMenuOpenRegistration()
  return (
    <ContextMenuPrimitive.Root
      disabled={disabled || !enabled}
      onOpenChange={(open, details) => {
        register(open)
        onOpenChange?.(open, details)
      }}
      {...props}
    />
  )
}

function ContextMenuPortal({ ...props }: ContextMenuPrimitive.Portal.Props) {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
}

/**
 * The right-click surface. Renders a plain `<div>` and takes every div prop,
 * so an existing row becomes the trigger rather than gaining a wrapper around
 * it — which is what keeps drag refs, drop-indicator geometry and data
 * attributes on the element that already carried them.
 */
function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 2,
  className,
  ...props
}: ContextMenuPrimitive.Popup.Props &
  Pick<
    ContextMenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn("z-50 max-h-(--available-height) min-w-44 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-(--shadow-raised) ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none", className )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuGroup({ ...props }: ContextMenuPrimitive.Group.Props) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSub({ ...props }: ContextMenuPrimitive.SubmenuRoot.Props) {
  return <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  )
}

function ContextMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuContent>) {
  return (
    <ContextMenuContent
      data-slot="context-menu-sub-content"
      className={cn("w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground shadow-(--shadow-raised) ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none", className )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: ContextMenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="context-menu-checkbox-item-indicator"
      >
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioGroup({ ...props }: ContextMenuPrimitive.RadioGroup.Props) {
  return (
    <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
  )
}

function ContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: ContextMenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="context-menu-radio-item-indicator"
      >
        <ContextMenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

/**
 * The trailing slot on a row. Named for the dropdown's use (a key hint), but
 * the card menu also uses it for a reschedule row's resolved date — which is
 * load-bearing rather than decorative, since it is what stops "In 2 days"
 * meaning something the user cannot see. See `quick-reschedule.ts`.
 */
function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/context-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenusEnabled,
  ContextMenuPortal,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
}
