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
          Two deviations from the shadcn base, both for the same reason — this
          checkbox's only home is a to-do row (components/board/todo-card.tsx),
          where it sits on a coloured group wash rather than on `background`:

          `rounded-none`, because a 4px radius on a 16px box is mostly lost at
          this size and squares off against the card's own geometry.

          `border-muted-foreground` in place of `border-input`. `--input` is
          `oklch(0.922 0 0)` in the light theme — a hair off white, which is
          fine on a plain surface and effectively invisible over a tinted one.
          The unchecked box is the affordance that says a row can be completed,
          so it cannot depend on the backdrop to be seen.
        */
        /*
          `pointer-coarse:` grows the `::after` hit area from 40×32 to a
          44×44 WCAG/HIG-comfortable square, matching DragGrip's established
          pattern (components/board/drag-grip.tsx) of stating each axis
          separately rather than as a single `-inset-N` shorthand —
          tailwind-merge does not recognize that the shorthand and the
          axis-specific forms target the same property, so mixing them here
          would leave whichever one is undetected silently in the DOM.
        */
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-none border border-muted-foreground transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 pointer-coarse:after:-inset-x-3.5 pointer-coarse:after:-inset-y-3.5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
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
