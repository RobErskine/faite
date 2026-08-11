"use client";

import { useMemo, useState } from "react";
import { MapPin, Plus } from "lucide-react";
import {
  Autocomplete,
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
import { createPlace } from "@/lib/store/repositories";
import type { Place, Todo } from "@/lib/schema";

/**
 * A sentinel appended to the filtered list so "Save as a place" stays
 * keyboard-reachable (↓↓ Enter) as a real `Autocomplete.Item`, rather than a
 * sibling node cmdk-style tricks would be needed to keep visible.
 */
const CREATE_SENTINEL = { kind: "create" } as const;
type ListEntry = Place | typeof CREATE_SENTINEL;

const isCreateEntry = (entry: ListEntry): entry is typeof CREATE_SENTINEL =>
  "kind" in entry && entry.kind === "create";

interface LocationFieldProps {
  todo: Todo;
  places: Place[];
  onSave: (id: string, patch: Partial<Todo>) => void;
}

/**
 * `Todo.location` free text, with saved-place typeahead layered on top.
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
 */
export function LocationField({ todo, places, onSave }: LocationFieldProps) {
  const [text, setText] = useState(todo.location ?? "");
  const { contains } = useAutocompleteFilter({ sensitivity: "base" });

  // Revealed inline below the field rather than in a second dialog: no
  // nested portal, no second focus-trap layered on the Sheet's own.
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");

  const attachedPlace = todo.placeId ? places.find((p) => p.id === todo.placeId) : undefined;

  const items = useMemo<ListEntry[]>(() => {
    const query = text.trim();
    const matches = query
      ? places.filter((p) => contains(p.name, query) || contains(p.address, query))
      : places;
    return query ? [...matches, CREATE_SENTINEL] : matches;
  }, [places, text, contains]);

  const commitText = (value: string) => {
    if (value === (todo.location ?? "")) return;
    // Typing directly means it no longer matches whichever saved place was
    // selected — clear the link so a stale nickname can't keep showing for
    // text that has since diverged from it.
    onSave(todo.id, { location: value || null, placeId: null });
  };

  const selectPlace = (place: Place) => {
    setText(place.address);
    onSave(todo.id, { placeId: place.id, location: place.address });
  };

  const startSavingPlace = () => {
    setNickname(text.trim());
    setPendingAddress(text.trim());
  };

  const confirmSavePlace = async () => {
    const address = pendingAddress ?? text.trim();
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) return;
    const id = await createPlace(trimmedNickname, address);
    onSave(todo.id, { placeId: id, location: address });
    setText(address);
    setPendingAddress(null);
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
        itemToStringValue={(entry: ListEntry) => (isCreateEntry(entry) ? text : entry.address)}
        filter={null}
        openOnInputClick
      >
        <AutocompleteInput
          id="todo-location-input"
          placeholder="Grocery store, the in-laws' house…"
          onBlur={(e) => commitText(e.target.value)}
        />
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
                      onClick={startSavingPlace}
                      className="text-muted-foreground"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Save “{text.trim()}” as a place…
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

      {pendingAddress !== null && (
        <div className="space-y-1.5 rounded-md border p-2">
          <Label htmlFor="todo-location-nickname" className="text-xs text-muted-foreground">
            Nickname for this place
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
            <Button variant="ghost" size="sm" onClick={() => setPendingAddress(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
