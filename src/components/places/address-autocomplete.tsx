"use client";

import { MapPin } from "lucide-react";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
} from "@/components/ui/autocomplete";
import { formatSuggestion, type PlaceSuggestion, type ResolvedPlace } from "@/lib/places/wire";
import { usePlaceSearch, type PlaceSearchStatus } from "./use-place-search";

/**
 * A plain address field with Google Places suggestions layered on — EI-83.
 *
 * The default renderer for `usePlaceSearch`, used wherever the list is *only*
 * remote suggestions. `LocationField` deliberately does NOT use it: that field
 * merges saved places and a "save as a place" row into the same list, so it
 * consumes the hook directly and renders its own items. The hook is the shared
 * unit here, not this component.
 *
 * Free text is always valid. If the lookup is unavailable — signed out, no key
 * on this deployment, offline — this degrades to exactly what it was before
 * the feature existed: a text input. No error, no nag, no "sign in to use
 * this". You can still type an address, we just don't match it.
 */

interface AddressAutocompleteProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Fires once per pick, after Place Details resolves. */
  onResolve: (place: ResolvedPlace, suggestion: PlaceSuggestion) => void;
  placeholder?: string;
  className?: string;
}

/** `null` collapses the element via `empty:hidden` — see `ui/autocomplete.tsx`. */
function emptyMessage(status: PlaceSearchStatus): string | null {
  if (status === "loading") return "Searching…";
  if (status === "ready") return "No matches.";
  return null;
}

export function AddressAutocomplete({
  id,
  value,
  onValueChange,
  onResolve,
  placeholder = "Start typing an address…",
  className,
}: AddressAutocompleteProps) {
  const { suggestions, status, resolve } = usePlaceSearch(value);

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    // Base UI has already written this into the input synchronously; mirroring
    // it into our own state keeps the two in step while Details is in flight.
    const label = formatSuggestion(suggestion);
    onValueChange(label);

    const place = await resolve(suggestion.placeId, label);
    // Keep the optimistic label on failure — the user has a usable address
    // either way, it just isn't linked to a Google place id.
    if (!place) return;

    onValueChange(place.address);
    onResolve(place, suggestion);
  };

  return (
    <Autocomplete
      items={suggestions}
      value={value}
      onValueChange={onValueChange}
      itemToStringValue={formatSuggestion}
      // Results are already filtered by Google against this exact query;
      // filtering them again locally would only drop good matches.
      filter={null}
    >
      <AutocompleteInput
        id={id}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      <AutocompletePortal>
        <AutocompletePositioner>
          <AutocompletePopup>
            <AutocompleteEmpty>{emptyMessage(status)}</AutocompleteEmpty>
            <AutocompleteList>
              {(suggestion: PlaceSuggestion) => (
                <AutocompleteItem
                  key={suggestion.placeId}
                  value={suggestion}
                  onClick={() => void selectSuggestion(suggestion)}
                >
                  <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{suggestion.primary}</span>
                    {suggestion.secondary && (
                      <span className="truncate text-xs text-muted-foreground">
                        {suggestion.secondary}
                      </span>
                    )}
                  </span>
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </AutocompletePopup>
        </AutocompletePositioner>
      </AutocompletePortal>
    </Autocomplete>
  );
}
