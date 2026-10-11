import { coversDemo, loadGraph } from "@/lib/osm/load";
import { overpass } from "@/lib/osm/overpass";
import { buildPoiCorridorQuery } from "@/lib/osm/query";
import { wikiPois } from "@/lib/osm/wikipedia";
import { haversine, type LngLat } from "./geo";
import type { OsmElement } from "./graph";
import { classifyPoi, type Poi } from "./poi";

export interface SurpriseDestination {
  lngLat: LngLat;
  name: string;
  kind: string;
  image?: string;
}

export class SurpriseError extends Error {}

/** Live candidates around a point outside the bundled area: Wikipedia + Overpass in parallel. */
async function livePois(start: LngLat, radius: number, signal?: AbortSignal): Promise<Poi[]> {
  const osm = overpass(buildPoiCorridorQuery(`${start[1].toFixed(5)},${start[0].toFixed(5)}`, radius, 12), signal, 12000)
    .then((j) =>
      ((j as { elements: OsmElement[] }).elements ?? []).flatMap((e) => {
        const c = e.type === "node" ? (e.lat !== undefined ? { lat: e.lat, lon: e.lon! } : undefined) : e.center;
        const p = c && e.tags ? classifyPoi(e.type, e.id, e.tags, [c.lon, c.lat]) : null;
        return p ? [p] : [];
      }),
    )
    .catch(() => [] as Poi[]);
  // Wikipedia answers fast; don't let a busy Overpass mirror hold the surprise for long.
  const wiki = await wikiPois([start], radius, signal);
  const a = await Promise.race([osm, new Promise<Poi[]>((r) => setTimeout(() => r([]), wiki.length ? 2500 : 8000))]);
  return [...a, ...wiki];
}

/**
 * "Yllätä minut": a truly random named place a walk away (≈0.7–2.5 km) from `start`.
 * Places with a photo, an article or a description are likelier, so there is something to tell.
 */
export async function surpriseDestination(
  start: LngLat,
  signal?: AbortSignal,
  minM = 700,
  maxM = 2500,
): Promise<SurpriseDestination> {
  let pois: Poi[];
  if (coversDemo(start, start)) {
    const g = await loadGraph(start, [start[0] + 0.001, start[1]], undefined, signal);
    pois = g.pois;
  } else {
    pois = await livePois(start, maxM, signal);
  }

  // Really random: every candidate in the ring has a chance; ones we can tell about are likelier.
  const candidates = pois
    .filter((p) => p.name && p.kind !== "Puisto")
    .filter((p) => {
      const d = haversine(start, p.lngLat);
      return d >= minM && d <= maxM;
    })
    .map((p) => ({
      p,
      w: 1 + (p.wikipedia || p.wikidata ? 2 : 0) + (p.image ? 1.5 : 0) + (p.description || p.detail ? 1 : 0),
    }));
  const total = candidates.reduce((a, c) => a + c.w, 0);
  let r = Math.random() * total;
  const best = candidates.find((c) => (r -= c.w) <= 0)?.p ?? candidates[candidates.length - 1]?.p;
  if (!best) {
    throw new SurpriseError(
      "Läheltä ei löytynyt yllätettävää. Siirry kartalla vilkkaammalle alueelle tai valitse määränpää itse.",
    );
  }
  return { lngLat: best.lngLat, name: best.name!, kind: best.kind, image: best.image };
}
