"use client";

import { useEffect, useState } from "react";

/**
 * Trails `value` by `delayMs`, collapsing a burst of changes into one.
 *
 * A named, tested unit rather than an inline `setTimeout` in an effect because
 * of who uses it: the Google Places typeahead (EI-83), where the debounce is
 * not a polish detail but the **cost control** — every un-debounced keystroke
 * would be a billable Autocomplete request. See `use-place-search.ts`.
 *
 * The first value is emitted immediately: a debounce should delay *changes*,
 * not initial render. (The mount-time timer below still fires, but it sets
 * state to the value already held, which React bails out of.)
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    // Clears on the next change AND on unmount — without the latter a pending
    // timer fires setState into an unmounted component.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
