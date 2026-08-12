"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePlaces } from "@/lib/store/hooks";
import { createPlace, deletePlace } from "@/lib/store/repositories";

/**
 * Saved locations manager — SCAFFOLD. Every place here is entered by
 * hand: name (the nickname — "Home", "Gym") and address (whatever text the
 * user types). There is no Google Places typeahead wired up yet; see
 * `docs/GOOGLE-PLACES-SETUP.md` for what that would take.
 *
 * Assigning a saved place to a todo isn't built either — this section only
 * manages the list. `Todo.placeId` and the sync plumbing for the `place`
 * kind exist so this can be wired up without a schema change later.
 */
export function PlacesSection() {
  const places = usePlaces();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const handleAdd = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await createPlace(trimmedName, address.trim());
    setName("");
    setAddress("");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label>Saved places</Label>
        {places.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved places yet.</p>
        ) : (
          <ul className="space-y-2">
            {places.map((place) => (
              <li
                key={place.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{place.name}</p>
                  {place.address && (
                    <p className="truncate text-xs text-muted-foreground">{place.address}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${place.name}`}
                  onClick={() => void deletePlace(place.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="place-name">Add a place</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="place-name"
            placeholder="Nickname — Home, Gym, Mother-in-law's…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Address (optional)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => void handleAdd()} disabled={!name.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
