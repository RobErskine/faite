"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { AddressAutocomplete } from "@/components/places/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePlaces } from "@/lib/store/hooks";
import { createPlace, deletePlace } from "@/lib/store/repositories";
import type { ResolvedPlace } from "@/lib/places/wire";

/**
 * Saved locations manager — a nickname ("Home", "Gym") plus an address.
 *
 * The address field looks up real addresses through Google Places (EI-83), but
 * a hand-typed one is a first-class case, not a fallback: not every place is
 * worth a lookup, and a signed-out or offline user must still be able to save
 * one. Picking a suggestion additionally stores `googlePlaceId`/`lat`/`lng`.
 */
export function PlacesSection() {
  const places = usePlaces();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  /** Set only when `address` came from a Places pick — see `handleAddressChange`. */
  const [resolved, setResolved] = useState<ResolvedPlace | null>(null);

  const handleAddressChange = (value: string) => {
    setAddress(value);
    // Typing after a pick means the text no longer describes the place that
    // was looked up. Same rule `LocationField` applies to `placeId`: never let
    // a stale link outlive the text it was derived from.
    if (resolved && value !== resolved.address) setResolved(null);
  };

  const handleAdd = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedAddress = address.trim();
    await createPlace(
      trimmedName,
      trimmedAddress,
      resolved && resolved.address === trimmedAddress
        ? { googlePlaceId: resolved.placeId, lat: resolved.lat, lng: resolved.lng }
        : {},
    );
    setName("");
    setAddress("");
    setResolved(null);
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
          <div className="w-full min-w-0">
            <AddressAutocomplete
              id="place-address"
              value={address}
              onValueChange={handleAddressChange}
              onResolve={(place, suggestion) => {
                setResolved(place);
                // "Blue Bottle Coffee" is a better first guess at a nickname
                // than a blank box — but only as a guess: never overwrite one
                // the user has already typed.
                setName((current) => (current.trim() ? current : suggestion.primary));
              }}
              placeholder="Address (optional)"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={!name.trim()}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
