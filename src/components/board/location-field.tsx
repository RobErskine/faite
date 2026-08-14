"use client";

import { useMemo, useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { usePlaceSearch } from "@/components/places/use-place-search";
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  useAutocompleteFilter,
} from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatSuggestion, type PlaceSuggestion, type ResolvedPlace } from "@/lib/places/wire";
import { createPlace } from "@/lib/store/repositories";
import type { Place, Todo } from "@/lib/schema";

/**
 * The list is three kinds of row, in cost order: saved places (a local Dexie
 * read — free, instant, works offline), then Google suggestions, then the
 * "save as a place" sentinel as the none-of-the-above fallback. All three are
 * real `Autocomplete.Item`s so they stay keyboard-reachable (↓↓ Enter) —
 * see `docs/PICKERS.md` §3.
 */
interface RemoteEntry {
  kind: "remote";
  suggestion: PlaceSuggestion;
}
interface CreateEntry {
  kind: "create";
  query: string;
}
type ListEntry = Place | RemoteEntry | CreateEntry;

/**
 * A per-render factory rather than a frozen module constant, closing over the
 * query at the moment the row was rendered. `onValueChange` and
 * `onInputValueChange` fire out of the same click, so a handler that reads
 * `text` state at pick time is not guaranteed to see what was on screen when
 * the row was drawn (`docs/PICKERS.md` §3). Mandatory here rather than merely
 * tidy: a remote pick reads its suggestion at pick time too.
 */
const createSentinel = (query: string): CreateEntry => ({ kind: "create", query });

const isCreateEntry = (entry: ListEntry): entry is CreateEntry =>
  "kind" in entry && entry.kind === "create";
const isRemoteEntry = (entry: ListEntry): entry is RemoteEntry =>
  "kind" in entry && entry.kind === "remote";

interface LocationFieldProps {
  todo: Todo;
  places: Place[];
  onSave: (id: string, patch: Partial<Todo>) => void;
}

/**
 * `Todo.location` free text, with saved-place and Google Places typeahead
 * layered on top.
 *
 * The input's value IS `location` — there is no separate "selection state"
 * to reconcile. Picking a suggestion writes `{placeId, location: place.
 * address}`; typing clears `placeId` the moment the text no longer matches
 * it. This is why Base UI's Autocomplete is the right primitive here rather
 * than Combobox: free text that a selection only ever *fills in*, not a
 * persistent choice — see `ui/autocomplete.tsx`'s header comment.
 *
 * Existing free-text `location` values need no migration: they render
 * exactly as before, and "Save as a place" from the text already typed is
 * the promotion path — no `Place` rows are ever backfilled automatically.
 *
 * Everything except the Google rows works signed out and offline. That is the
 * product rule, not a graceful-degradation afterthought: you can always type
 * an address, we just don't always match it (EI-83).
 */
export function LocationField({ todo, places, onSave }: LocationFieldProps) {
  const [text, setText] = useState(todo.location ?? "");
  const { contains } = useAutocompleteFilter({ sensitivity: "base" });

  // Revealed inline below the field rather than in a second dialog: no
  // nested portal, no second focus-trap layered on the Sheet's own.
  const [pending, setPending] = useState<{ address: string; google: ResolvedPlace | null } | null>(
    null,
  );
  const [nickname, setNickname] = useState("");

  const attachedPlace = todo.placeId ? places.find((p) => p.id === todo.placeId) : undefined;

  const query = text.trim();

  /**
   * Recall-by-nickname must stay free: typing "Ho" to reach a saved "Home" is
   * a local read and should never reach Google (`docs/LOCATION.md` §5).
   * Deliberately a **name prefix**, not "any local match" — the list
   * filter below also matches on `address`, and an address-substring hit is
   * exactly the case where the user IS typing a real address and does want
   * suggestions.
   */
  const matchesSavedNickname = useMemo(
    () => query.length > 0 && places.some((p) => p.name.toLowerCase().startsWith(query.toLowerCase())),
    [places, query],
  );

  const { suggestions, resolve } = usePlaceSearch(query, { enabled: !matchesSavedNickname });

  const items = useMemo<ListEntry[]>(() => {
    const matches = query
      ? places.filter((p) => contains(p.name, query) || contains(p.address, query))
      : places;
    if (!query) return matches;

    // A place already saved from this Google result is offered as the saved
    // row above, with its nickname — offering it twice would be a worse
    // version of the same thing.
    const saved = new Set(places.map((p) => p.googlePlaceId).filter(Boolean));
    const remote: RemoteEntry[] = suggestions
      .filter((s) => !saved.has(s.placeId))
      .map((suggestion) => ({ kind: "remote", suggestion }));

    return [...matches, ...remote, createSentinel(query)];
  }, [places, query, contains, suggestions]);

  const commitText = (value: string) => {
    if (value === (todo.location ?? "")) return;
    // Typing directly means it no longer matches whichever saved place was
    // selected — clear the link so a stale nickname can't keep showing for
    // text that has since diverged from it.
    onSave(todo.id, { location: value || null, placeId: null });
  };

  /**
   * Commits immediately rather than waiting for `onBlur` like typing does.
   * Clearing is an explicit, unambiguous action, and clicking the button does
   * not reliably blur the input — so deferring would leave the field looking
   * empty while the todo still carried its old location.
   */
  const clearLocation = () => {
    setText("");
    if (todo.location !== null || todo.placeId !== null) {
      onSave(todo.id, { location: null, placeId: null });
    }
  };

  const selectPlace = (place: Place) => {
    setText(place.address);
    onSave(todo.id, { placeId: place.id, location: place.address });
  };

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    // Base UI has already filled the input with this synchronously
    // (`fillInputOnItemPress`); mirror it so the optimistic value is committed
    // even if Place Details never answers.
    const label = formatSuggestion(suggestion);
    setText(label);
    onSave(todo.id, { location: label, placeId: null });

    const place = await resolve(suggestion.placeId, label);
    if (!place) return;

    setText(place.address);
    onSave(todo.id, { location: place.address, placeId: null });
    // Offer to save it: this is the only path by which a todo-sheet lookup
    // persists `googlePlaceId`/`lat`/`lng`. Dismissible — the address is
    // already committed as free text above either way.
    setPending({ address: place.address, google: place });
    setNickname(suggestion.primary);
  };

  const startSavingPlace = (address: string) => {
    setNickname(address);
    setPending({ address, google: null });
  };

  const confirmSavePlace = async () => {
    if (!pending) return;
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) return;

    const id = await createPlace(
      trimmedNickname,
      pending.address,
      pending.google
        ? {
            googlePlaceId: pending.google.placeId,
            lat: pending.google.lat,
            lng: pending.google.lng,
          }
        : {},
    );
    onSave(todo.id, { placeId: id, location: pending.address });
    setText(pending.address);
    setPending(null);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="todo-location-input">Location</Label>
      {attachedPlace && (
        <Badge variant="outline" className="w-fit gap-1 text-2xs font-normal">
          <MapPin className="size-2.5" aria-hidden />
          {attachedPlace.name}
        </Badge>
      )}

      <Autocomplete
        items={items}
        value={text}
        onValueChange={setText}
        itemToStringValue={(entry: ListEntry) =>
          isCreateEntry(entry)
            ? entry.query
            : isRemoteEntry(entry)
              ? formatSuggestion(entry.suggestion)
              : entry.address
        }
        filter={null}
        openOnInputClick
      >
        {/* `relative` anchors the clear button. Base UI's Positioner anchors
            to the Input itself, not to this wrapper, so the popup still lines
            up with (and matches the width of) the field. */}
        <div className="relative">
          <AutocompleteInput
            id="todo-location-input"
            placeholder="Grocery store, the in-laws' house…"
            onBlur={(e) => commitText(e.target.value)}
            autoComplete="off"
            className={text ? "pr-8" : undefined}
          />
          {/* Rendered only when there is something to clear — an always-present
              X on an empty field is a control that does nothing. */}
          {text && <AutocompleteClear aria-label="Clear location" onClick={clearLocation} />}
        </div>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              {/* Always mounted — see AutocompleteEmpty's own comment for why
                  skipping it lets Escape bubble past this popup and close
                  the whole sheet instead of just the popup. */}
              <AutocompleteEmpty>No saved places match.</AutocompleteEmpty>
              <AutocompleteList>
                {(entry: ListEntry) =>
                  isCreateEntry(entry) ? (
                    <AutocompleteItem
                      key="create"
                      value={entry}
                      onClick={() => startSavingPlace(entry.query)}
                      className="text-muted-foreground"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Save “{entry.query}” as a place…
                    </AutocompleteItem>
                  ) : isRemoteEntry(entry) ? (
                    <AutocompleteItem
                      key={`remote-${entry.suggestion.placeId}`}
                      value={entry}
                      onClick={() => void selectSuggestion(entry.suggestion)}
                    >
                      <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entry.suggestion.primary}</span>
                        {entry.suggestion.secondary && (
                          <span className="truncate text-xs text-muted-foreground">
                            {entry.suggestion.secondary}
                          </span>
                        )}
                      </span>
                    </AutocompleteItem>
                  ) : (
                    <AutocompleteItem key={entry.id} value={entry} onClick={() => selectPlace(entry)}>
                      <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entry.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.address}
                        </span>
                      </span>
                    </AutocompleteItem>
                  )
                }
              </AutocompleteList>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>

      {pending !== null && (
        <div className="space-y-1.5 rounded-md border p-2">
          {/*
            "(optional)" qualifies the whole STEP, not the field. The address
            is already committed to the todo by the time this appears — saving
            it as a reusable place is the extra, skippable part. The nickname
            itself is required once you commit to that (`placeSchema.name` is
            `min(1)`, and an unnamed saved place is unrecallable), which is why
            Save stays disabled while it is empty.
          */}
          <Label htmlFor="todo-location-nickname" className="text-xs text-muted-foreground">
            Give this place a nickname to save it for reuse later{" "}
            <span className="opacity-70">(optional)</span>
          </Label>
          <div className="flex gap-2">
            <Input
              id="todo-location-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmSavePlace();
                }
              }}
              autoFocus
            />
            <Button size="sm" onClick={() => void confirmSavePlace()} disabled={!nickname.trim()}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
