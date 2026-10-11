import { overpass } from "@/lib/osm/overpass";
import { buildPoiCorridorQuery } from "@/lib/osm/query";
import { valhallaRoute, ValhallaError, type Travel } from "@/lib/osm/valhalla";
import { samplePoints, wikiPois } from "@/lib/osm/wikipedia";
import {
  AdventureError,
  joinLegs,
  midpointStop,
  lineOf,
  poiAt,
  selectStops,
  tellStory,
  toMidstop,
  WANDER,
  type Adventure,
  type AdventureStyle,
  type Wander,
} from "./adventure-core";
import { distToSegment, haversine, Projector, type LngLat } from "./geo";
import type { OsmElement } from "./graph";
import { classifyPoi, type Poi } from "./poi";

const WALK_M_PER_MIN = 75;

function simplify(coords: LngLat[], max: number): LngLat[] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

async function corridorPois(line: LngLat[], radius: number, proj: Projector, signal?: AbortSignal): Promise<Poi[]> {
  const pts = simplify(line, 40)
    .map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
    .join(",");
  try {
    const json = (await overpass(buildPoiCorridorQuery(pts, radius, 15), signal, 15000)) as { elements: OsmElement[] };
    const out: Poi[] = [];
    const seen = new Set<string>();
    for (const e of json.elements) {
      const c = e.type === "node" ? (e.lat !== undefined ? { lat: e.lat, lon: e.lon! } : undefined) : e.center;
      if (!c || !e.tags) continue;
      const p = classifyPoi(e.type, e.id, e.tags, [c.lon, c.lat]);
      if (!p) continue;
      const key = `${p.name ?? p.id}|${Math.round(c.lat * 2000)}|${Math.round(c.lon * 2000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      p.x = proj.x(c.lon);
      p.y = proj.y(c.lat);
      out.push(p);
    }
    return out;
  } catch (e) {
    if (signal?.aborted) throw e;
    // Without POIs we still have a route — the midpoint becomes the stop.
    return [];
  }
}

/** Merge Wikipedia places into OSM ones; a Wikipedia hit next to a same-named OSM place enriches it instead. */
export function mergePois(osm: Poi[], wiki: Poi[], proj: Projector): Poi[] {
  const out = [...osm];
  for (const w of wiki) {
    w.x = proj.x(w.lngLat[0]);
    w.y = proj.y(w.lngLat[1]);
    const twin = out.find(
      (o) =>
        (!!w.wikidata && o.wikidata === w.wikidata) ||
        (Math.hypot(o.x - w.x, o.y - w.y) < 150 && !!o.name && o.name.toLowerCase() === w.name?.toLowerCase()),
    );
    if (twin) {
      twin.image ??= w.image;
      twin.wikipedia ??= w.wikipedia;
      twin.popularity = Math.max(twin.popularity, w.popularity);
    } else out.push(w);
  }
  return out;
}

function lengthOf(coords: LngLat[]) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i]);
  return s;
}

/** POIs within `radius` m of the route, in walking order. */
function poisAlongLine(coords: LngLat[], pois: Poi[], proj: Projector, radius = 40): Poi[] {
  const xs = coords.map((c) => proj.x(c[0]));
  const ys = coords.map((c) => proj.y(c[1]));
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const hits: [Poi, number][] = [];
  for (const p of pois) {
    let best = Infinity;
    let at = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      if (Math.abs(xs[i] - p.x) > 400 && Math.abs(xs[i + 1] - p.x) > 400) continue;
      const d = distToSegment(p.x, p.y, xs[i], ys[i], xs[i + 1], ys[i + 1]);
      if (d < best) {
        best = d;
        at = cum[i];
      }
    }
    if (best <= radius) hits.push([p, at]);
  }
  return hits.sort((a, b) => a[1] - b[1]).map(([p]) => p);
}

/** Long trips: Valhalla walking routes on OSM data + stops from an Overpass corridor search. */
export async function computeLongAdventure(
  from: LngLat,
  to: LngLat,
  style: AdventureStyle,
  wander: Wander,
  signal?: AbortSignal,
  /** Places from bundled data, used when the live Overpass search comes back empty. */
  fallbackPois: Poi[] = [],
  travel: Travel = "walk",
  /** Exact stops (shared link): skip selection, keep them all, in this order. */
  fixed?: LngLat[],
): Promise<Adventure> {
  const W = WANDER[wander];
  const proj = new Projector((from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
  const profile = style === "scenic" ? "scenic" : "wander";
  // A car covers ground ~10× faster, so stops may lie farther off the road.
  const reach = travel === "car" ? 3 : 1;

  let fast;
  try {
    fast = await valhallaRoute([from, to], "fast", signal, travel);
  } catch (e) {
    if (signal?.aborted) throw e;
    const msg = e instanceof ValhallaError ? e.message : "";
    throw new AdventureError(
      /distance|exceed/i.test(msg)
        ? `Matka on liian pitkä ${travel === "car" ? "reititettäväksi" : "kävellen reititettäväksi"}. Valitse lähempi määränpää.`
        : "Reittipalvelu ei juuri nyt vastaa. Odota hetki ja yritä uudelleen – tai kokeile Helsingin keskustan esimerkkiretkiä, jotka toimivat aina.",
    );
  }
  const fastCoords = fast.legs.flat();
  if (fastCoords.length && (haversine(from, fastCoords[0]) > 300 || haversine(to, fastCoords[fastCoords.length - 1]) > 300))
    throw new AdventureError(
      "Valitsemasi kohta on vedessä tai kaukana kävelyteistä. Valitse kohta lähempää katua tai polkua.",
    );
  const D = haversine(from, to);
  const radius =
    reach *
    Math.min(wander === 11 ? 3500 : wander >= 4 ? 1500 : 900, W.dev * Math.min(2, Math.max(0.7, Math.sqrt(D / 2000))) + 50);
  // Two worldwide sources in parallel: OSM curiosities (Overpass) and notable places with photos (Wikipedia).
  // Wikipedia usually answers in ~1–2 s; busy Overpass mirrors can take 15 s. Once Wikipedia is in,
  // give Overpass at most ~3 s more (and 7 s overall) instead of keeping the user waiting.
  const t0 = Date.now();
  const osmPromise = corridorPois(fastCoords, radius, proj, signal);
  // Sample densely enough that the search circles overlap along the whole route (long trips need many).
  const wikiFound = await wikiPois(samplePoints(fastCoords, Math.max(700, radius * 1.2), 20), radius + 300, signal);
  const grace = Math.max(1500, Math.min(3000, 7000 - (Date.now() - t0)));
  const osmPois = await Promise.race([
    osmPromise,
    new Promise<Poi[]>((r) => setTimeout(() => r([]), grace)),
  ]);
  let pois = mergePois(osmPois, wikiFound, proj);
  if (!pois.length && fallbackPois.length)
    pois = fallbackPois.map((p) => ({ ...p, x: proj.x(p.lngLat[0]), y: proj.y(p.lngLat[1]) }));

  const fastLine = lineOf(
    fastCoords.map((c) => proj.x(c[0])),
    fastCoords.map((c) => proj.y(c[1])),
  );
  let picked = fixed?.length
    ? fixed.map((ll, i) => ({ p: poiAt(pois, ll, proj.x(ll[0]), proj.y(ll[1]), i), v: 1, dev: 0, along: i }))
    : selectStops(pois, fastLine, style, wander, Math.random, reach);
  const limit = fixed?.length ? Infinity : fast.lengthM * (1 + W.budget * 1.5) + 250;

  let route = fast;
  for (let attempt = 0; attempt < 4 && picked.length; attempt++) {
    try {
      const r = await valhallaRoute([from, ...picked.map((c) => c.p.lngLat), to], profile, signal, travel);
      // A stop on an island would add a ferry ride the plain route doesn't need: drop that stop.
      const ferryLeg = fixed?.length || fast.legFerry.some(Boolean) ? -1 : r.legFerry.findIndex(Boolean);
      if (ferryLeg >= 0) {
        const culprit = Math.min(ferryLeg, picked.length - 1);
        picked = picked.filter((_, i) => i !== culprit);
        continue;
      }
      if (r.lengthM <= limit || picked.length === 1 || attempt === 2) {
        route = r;
        break;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
    // Too long or unroutable: drop the least interesting stop.
    const worst = picked.reduce((w, c) => (c.v < w.v ? c : w));
    picked = picked.filter((c) => c !== worst);
  }
  if (route === fast) picked = [];

  const coords = joinLegs(
    route.legs,
    picked.map((c) => c.p.lngLat),
  );
  const lengthM = lengthOf(coords);
  const stopIds = new Set(picked.map((c) => c.p.id));
  const along = poisAlongLine(coords, pois, proj).filter((p) => !stopIds.has(p.id) && p.score >= 2.6);

  let stops = picked.map((c) => toMidstop(c.p));
  if (!stops.length) {
    const best = [...along].sort((a, b) => b.score - a.score)[0];
    stops = [best ? toMidstop(best) : midpointStop(coords)];
  }

  // Walking: our steady 4.5 km/h. Driving: Valhalla's own estimate.
  const minutes = travel === "car" ? route.timeS / 60 : lengthM / WALK_M_PER_MIN;
  const fastMinutes = travel === "car" ? fast.timeS / 60 : fast.lengthM / WALK_M_PER_MIN;
  return {
    style,
    wander,
    travel,
    coords,
    stops,
    midstop: stops[0],
    distanceM: Math.round(lengthM),
    durationMin: Math.max(1, Math.round(minutes)),
    fastMin: Math.max(1, Math.round(fastMinutes)),
    fastCoords,
    story: tellStory(style, minutes, fastMinutes, stops, along.length),
    pois: along.map((p) => ({ id: p.id, lngLat: p.lngLat, name: p.name, kind: p.kind })),
    stats: { greenShare: 0, waterMeters: 0, steps: 0, turns: 0 },
    startSnapped: coords[0],
    endSnapped: coords[coords.length - 1],
  };
}
