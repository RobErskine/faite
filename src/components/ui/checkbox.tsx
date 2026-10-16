"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        /*
          Two deviations from the shadcn base, both tuned for this
          checkbox's original home, a to-do row (components/board/todo-card.tsx),
          where it sits on a colored group wash rather than on `background`
          (also used plainly in settings/api-keys-section.tsx, where both
          deviations are harmless on a flat surface):

          `rounded-none`, because a 4px radius on a 16px box is mostly lost at
          this size and squares off against the card's own geometry.

          `border-muted-foreground` in place of `border-input`. `--input` is
          `oklch(0.922 0 0)` in the light theme — a hair off white, which is
          fine on a plain surface and effectively invisible over a tinted one.
          The unchecked box is the affordance that says a row can be completed,
          so it cannot depend on the backdrop to be seen.
        */
        /*
          Focus is the board's one `focus-ring` (globals.css; docs/DESIGN.md
          §3), not shadcn's `border-ring ring-3 ring-ring/50`. That halo is the
          ring color at 50% and measured 1.97:1 against the page — under the
          3:1 a focus indicator needs — and it was the one control on the row
          whose focus looked different from its neighbors' (EI-395).
        */
        /*
          `pointer-coarse:` grows the `::after` hit area to a 44×44
          WCAG/HIG-comfortable square. 15px, not 14 (`-inset-3.5`): an
          absolute box is placed from the PADDING box, inside the 1px border,
          so 14px each way made 14 + 28 = 42 (measured, EI-388). It follows
          DragGrip's pattern (components/board/drag-grip.tsx) of stating each axis
          separately rather than as a single `-inset-N` shorthand —
          tailwind-merge does not recognize that the shorthand and the
          axis-specific forms target the same property, so mixing them here
          would leave whichever one is undetected silently in the DOM.
        */
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-none border border-muted-foreground transition-colors focus-ring group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 pointer-coarse:after:-inset-x-[15px] pointer-coarse:after:-inset-y-[15px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
