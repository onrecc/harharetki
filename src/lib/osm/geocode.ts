import type { LngLat } from "@/lib/routing/geo";
import { loadPlaces, reverseLocal } from "./places";

/** Bilingual "Kaivopuisto / Brunnsparken" → "Kaivopuisto". */
const firstPart = (n?: string) => (n?.includes(" / ") ? n.split(" / ")[0].trim() : n);

export interface Place {
  id: string;
  name: string;
  context: string;
  lngLat: LngLat;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    country?: string;
  };
}

/** Search OSM places with Photon (komoot), biased towards the current map view. */
export async function searchPlaces(q: string, near: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "default"); // local (Finnish) names instead of English
  url.searchParams.set("lon", String(near[0]));
  url.searchParams.set("lat", String(near[1]));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  let json: { features: PhotonFeature[] };
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = (await res.json()) as { features: PhotonFeature[] };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  const seen = new Set<string>();
  return json.features
    .map((f) => {
      const p = f.properties;
      const name = firstPart(p.name) ?? [p.street, p.housenumber].filter(Boolean).join(" ");
      const context = [p.name && p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}` : null, p.district, p.city]
        .filter(Boolean)
        .join(", ");
      return {
        id: `${p.osm_type}${p.osm_id}`,
        name: name || "Nimetön paikka",
        context,
        lngLat: f.geometry.coordinates as LngLat,
      };
    })
    .filter((p) => {
      const k = `${p.name}|${p.context}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

async function photonReverse(p: LngLat, signal: AbortSignal): Promise<string | null> {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lon", String(p[0]));
  url.searchParams.set("lat", String(p[1]));
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "default");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { features: PhotonFeature[] };
  const f = json.features[0]?.properties;
  const name = f ? (firstPart(f.name) ?? [f.street, f.housenumber].filter(Boolean).join(" ")) : "";
  if (!name) throw new Error("ei nimeä");
  return name;
}

async function nominatimReverse(p: LngLat, signal: AbortSignal): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lon", String(p[0]));
  url.searchParams.set("lat", String(p[1]));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", "fi");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { name?: string; address?: Record<string, string> };
  const a = j.address ?? {};
  const name = j.name || [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(" ");
  if (!name) throw new Error("ei nimeä");
  return name;
}

/**
 * Short human name for a clicked point. Instant from the bundled index in central Helsinki;
 * elsewhere the faster of Photon and Nominatim wins (max ~3 s).
 */
export async function reverseName(p: LngLat, signal?: AbortSignal): Promise<string | null> {
  await loadPlaces();
  const local = reverseLocal(p);
  if (local) return local;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await Promise.any([photonReverse(p, ctrl.signal), nominatimReverse(p, ctrl.signal)]);
  } catch {
    return null;
  } finally {
    ctrl.abort();
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
