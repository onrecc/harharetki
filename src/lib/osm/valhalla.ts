import type { LngLat } from "@/lib/routing/geo";

/** FOSSGIS-hosted Valhalla routing on OpenStreetMap data (free, no key). */
const VALHALLA = "https://valhalla1.openstreetmap.de/route";

export class ValhallaError extends Error {}

export interface ValhallaRoute {
  /** One coordinate list per leg (start → stop1 → … → end). */
  legs: LngLat[][];
  lengthM: number;
  /** Valhalla's travel-time estimate in seconds. */
  timeS: number;
  /** Per leg: does it take a ferry? */
  legFerry: boolean[];
}

/** Decode a Valhalla polyline with 6-digit precision. */
function decode(str: string): LngLat[] {
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
}

export type WalkProfile = "fast" | "scenic" | "wander";
export type Travel = "walk" | "car";

const COSTING: Record<WalkProfile, Record<string, number>> = {
  fast: {},
  // Prefer footpaths and parks' paths over sidewalks along busy roads.
  scenic: { walkway_factor: 0.6, sidewalk_factor: 1.3, use_tracks: 0.9, use_living_streets: 0.9 },
  // Alleys and small streets welcome.
  wander: { walkway_factor: 0.8, alley_factor: 0.8, use_living_streets: 1 },
};

const CAR_COSTING: Record<WalkProfile, Record<string, number>> = {
  fast: {},
  // Scenic drives stay off motorways and toll roads.
  scenic: { use_highways: 0, use_tolls: 0, use_living_streets: 0.5 },
  wander: { use_highways: 0.2, use_tolls: 0 },
};

export async function valhallaRoute(
  points: LngLat[],
  profile: WalkProfile,
  signal?: AbortSignal,
  travel: Travel = "walk",
): Promise<ValhallaRoute> {
  const costing = travel === "car" ? "auto" : "pedestrian";
  const body = {
    locations: points.map(([lon, lat]) => ({ lat, lon, type: "break" })),
    costing,
    // Avoid ferries unless there is no other way (islands like Suomenlinna still get one).
    costing_options: { [costing]: { use_ferry: 0, ...(travel === "car" ? CAR_COSTING : COSTING)[profile] } },
    directions_type: "none",
    units: "kilometers",
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(body))}`, { signal: ctrl.signal });
    const json = await res.json();
    if (!res.ok || !json.trip) {
      throw new ValhallaError(json?.error ?? `HTTP ${res.status}`);
    }
    const rawLegs = json.trip.legs as { shape: string; summary?: { has_ferry?: boolean } }[];
    const legs = rawLegs.map((l) => decode(l.shape));
    return {
      legs,
      lengthM: json.trip.summary.length * 1000,
      timeS: json.trip.summary.time,
      legFerry: rawLegs.map((l) => !!l.summary?.has_ferry),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
