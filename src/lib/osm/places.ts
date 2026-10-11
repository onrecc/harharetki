import type { LngLat } from "@/lib/routing/geo";
import type { Place } from "./geocode";

/** Compact index built by scripts/build-places.mjs: streets with sample points, and named places. */
interface PlacesIndex {
  streets: [name: string, flat: number[]][];
  places: [name: string, lng: number, lat: number][];
}

interface Entry {
  name: string;
  norm: string;
  kind: "street" | "place";
  points: LngLat[];
}

let entries: Entry[] | null = null;
let loading: Promise<Entry[]> | null = null;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/** Load the local index once (≈150 kB). Safe to call often; never throws. */
export function loadPlaces(): Promise<Entry[]> {
  if (entries) return Promise.resolve(entries);
  loading ??= fetch("/data/places.json")
    .then((r) => (r.ok ? (r.json() as Promise<PlacesIndex>) : { streets: [], places: [] }))
    .then((idx) => {
      const list: Entry[] = [];
      for (const [name, flat] of idx.streets) {
        const points: LngLat[] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
        if (points.length) list.push({ name, norm: norm(name), kind: "street", points });
      }
      for (const [name, lng, lat] of idx.places) list.push({ name, norm: norm(name), kind: "place", points: [[lng, lat]] });
      entries = list;
      return list;
    })
    .catch(() => {
      loading = null;
      return [];
    });
  return loading;
}

/** Instant prefix search over the local index; empty until loadPlaces() has resolved. */
export function searchLocal(q: string, limit = 5): Place[] {
  if (!entries) return [];
  const nq = norm(q);
  if (nq.length < 2) return [];
  const scored: [Entry, number][] = [];
  for (const e of entries) {
    let s: number;
    if (e.norm.startsWith(nq)) s = 0;
    else if (e.norm.split(/[\s\-,]+/).some((w) => w.startsWith(nq))) s = 1;
    else if (nq.length >= 4 && e.norm.includes(nq)) s = 2;
    else continue;
    scored.push([e, s + e.name.length / 200 + (e.kind === "street" ? 0.05 : 0)]);
  }
  const seen = new Set<string>();
  return scored
    .sort((a, b) => a[1] - b[1])
    .filter(([e]) => !seen.has(e.norm) && !!seen.add(e.norm))
    .slice(0, limit)
    .map(([e]) => ({
      id: `local:${e.kind}:${e.name}`,
      name: e.name,
      context: e.kind === "street" ? "Katu · Helsinki" : "Paikka · Helsinki",
      lngLat: e.points[Math.floor(e.points.length / 2)],
    }));
}

const metres = (a: LngLat, b: LngLat) =>
  Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110574);

/** Nearest named place (within 45 m) or street (within 70 m) from the local index. */
export function reverseLocal(p: LngLat): string | null {
  if (!entries) return null;
  let bestPlace: [string, number] | null = null;
  let bestStreet: [string, number] | null = null;
  for (const e of entries) {
    for (const q of e.points) {
      if (Math.abs(q[1] - p[1]) > 0.001) continue;
      const d = metres(p, q);
      if (e.kind === "place" && d < 45 && (!bestPlace || d < bestPlace[1])) bestPlace = [e.name, d];
      if (e.kind === "street" && d < 70 && (!bestStreet || d < bestStreet[1])) bestStreet = [e.name, d];
    }
  }
  // A shop 40 m away is a worse name for a spot than the street it is on.
  if (bestPlace && (bestPlace[1] < 20 || !bestStreet)) return bestPlace[0];
  return bestStreet?.[0] ?? bestPlace?.[0] ?? null;
}
