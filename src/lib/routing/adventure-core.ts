import type { LngLat } from "./geo.ts";
import { nearestNode, snapDistance, type Graph } from "./graph.ts";
import type { Poi, PoiCat } from "./poi.ts";
import { computeStats, edgeCosts, pathEdges, pathLength, poisAlong, shortestPath, toCoords } from "./route.ts";

export type AdventureStyle = "scenic" | "historic" | "surprise";
export type Wander = 1 | 2 | 3 | 4 | 5 | 11;

export interface Midstop {
  id: string;
  lngLat: LngLat;
  name: string;
  kind: string;
  cat: PoiCat;
  blurb?: string;
  wikiUrl?: string;
  image?: string;
  /** Wikipedia reference from OSM, e.g. "fi:Havis Amanda". */
  wikipedia?: string;
  /** Wikidata item id from OSM, used to find an article, description or photo. */
  wikidata?: string;
}

export interface AdventurePoi {
  id: string;
  lngLat: LngLat;
  name?: string;
  kind: string;
}

export interface Adventure {
  style: AdventureStyle;
  wander: Wander;
  /** How the trip is made; walking unless planned with { travel: "car" }. */
  travel?: "walk" | "car";
  /** Route geometry; passes through every stop. */
  coords: LngLat[];
  /** Stops in walking order. */
  stops: Midstop[];
  /** First stop (kept for compatibility). */
  midstop: Midstop;
  distanceM: number;
  durationMin: number;
  /** Minutes on the plain fastest route, for "+X min" comparisons. */
  fastMin: number;
  /** Fastest route geometry, to contrast with the adventure. */
  fastCoords: LngLat[];
  /** One-line Finnish story about the trip. */
  story: string;
  /** Other curiosities within a few dozen metres of the route, in walking order. */
  pois: AdventurePoi[];
  stats: { greenShare: number; waterMeters: number; steps: number; turns: number };
  /** Where the route actually starts and ends (nearest walkable point to the chosen spots). */
  startSnapped: LngLat;
  endSnapped: LngLat;
}

export class AdventureError extends Error {
  /** "no-path": no walkable connection in the graph (e.g. an island reached by ferry). */
  code?: "no-path";
  constructor(message: string, code?: "no-path") {
    super(message);
    this.code = code;
  }
}

export const WANDER_LABELS: Record<Wander, string> = {
  1: "Pieni mutka",
  2: "Kiertotie",
  3: "Harharetki",
  4: "Seikkailu",
  5: "Eksyksissä",
  11: "Täysin sekaisin",
};

/**
 * How far each wander level may stray from the fastest route:
 * `dev` max metres a stop may lie off the fastest route (scaled with trip length),
 * `budget` total extra walking as a share of the fastest route,
 * `per` one stop per this many metres of trip (so short trips get few stops), `cap` max stops.
 */
export const WANDER: Record<Wander, { dev: number; budget: number; per: number; cap: number; weird: number }> = {
  1: { dev: 70, budget: 0.12, per: 1800, cap: 1, weird: 0 },
  2: { dev: 160, budget: 0.25, per: 1100, cap: 2, weird: 0 },
  3: { dev: 300, budget: 0.45, per: 750, cap: 3, weird: 0.5 },
  4: { dev: 500, budget: 0.75, per: 550, cap: 5, weird: 1 },
  5: { dev: 800, budget: 1.1, per: 400, cap: 7, weird: 1.5 },
  // "Täysin sekaisin": roams far, but only for places worth it (see selectStops).
  11: { dev: 3500, budget: 5, per: 220, cap: 12, weird: 1.5 },
};

/** A route polyline in projected metres, with cumulative distance. */
export interface RouteLine {
  xs: number[];
  ys: number[];
  cum: number[];
  length: number;
}

export function lineOf(xs: number[], ys: number[]): RouteLine {
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  return { xs, ys, cum, length: cum[cum.length - 1] ?? 0 };
}

/** Distance from a point to the line, and how far along the line its nearest point is. */
function locate(line: RouteLine, x: number, y: number): { dev: number; along: number } {
  let dev = Infinity;
  let along = 0;
  for (let i = 0; i + 1 < line.xs.length; i++) {
    const ax = line.xs[i], ay = line.ys[i], bx = line.xs[i + 1], by = line.ys[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < dev) {
      dev = d;
      along = line.cum[i] + t * Math.sqrt(l2);
    }
  }
  return { dev, along };
}

const STYLE_CATS: Record<AdventureStyle, PoiCat[]> = {
  scenic: ["nature"],
  historic: ["history", "culture"],
  surprise: ["art", "curio", "nature", "history"],
};

/** Not "nature", but lovely to walk past. */
const SCENIC_EXTRA = new Set(["Suihkulähde", "Taidesuihkulähde", "Silta", "Majakka", "Tuulimylly", "Lintutorni"]);

const SCENIC_BONUS: Record<string, number> = {
  Näköalapaikka: 3,
  Ranta: 2,
  Lintutorni: 2,
  Kallio: 1.5,
  Puutarha: 1,
  "Merkittävä puu": 1,
};


export function styleFits(style: AdventureStyle, p: Poi): boolean {
  return STYLE_CATS[style].includes(p.cat) || (style === "scenic" && SCENIC_EXTRA.has(p.kind));
}

export interface Scored {
  p: Poi;
  v: number;
  dev: number;
  along: number;
}

/**
 * Choose stops among the sights near the fastest route. The wander level sets how far off the
 * route a stop may be and the total detour; trip length sets how many stops make sense.
 * Returned in walking order.
 */
export function selectStops(
  pois: Poi[],
  line: RouteLine,
  style: AdventureStyle,
  wander: Wander,
  random: () => number,
  /** Multiplier for how far off the route stops may be (e.g. 3 when driving). */
  reach = 1,
): Scored[] {
  const W = WANDER[wander];
  const L = Math.max(line.length, 1);
  const maxDev = reach * W.dev * Math.min(2, Math.max(0.7, Math.sqrt(L / 2000)));
  const maxStops = Math.min(W.cap, Math.max(1, Math.round(L / W.per)));
  const budget = W.budget * L + 80;
  const clear = Math.max(100, L * 0.08);
  const kindCount = new Map<string, number>();
  for (const p of pois) kindCount.set(p.kind, (kindCount.get(p.kind) ?? 0) + 1);

  // Quick bounding box so we only measure nearby candidates precisely.
  const x0 = Math.min(...line.xs) - maxDev, x1 = Math.max(...line.xs) + maxDev;
  const y0 = Math.min(...line.ys) - maxDev, y1 = Math.max(...line.ys) + maxDev;
  const sx = line.xs[0], sy = line.ys[0];
  const tx = line.xs[line.xs.length - 1], ty = line.ys[line.ys.length - 1];

  const located = pois
    .filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
    .filter((p) => Math.hypot(p.x - sx, p.y - sy) > clear && Math.hypot(p.x - tx, p.y - ty) > clear)
    .map((p) => ({ p, ...locate(line, p.x, p.y) }))
    .filter((c) => c.dev <= maxDev && c.along > clear * 0.6 && c.along < L - clear * 0.6);

  for (const anyCat of [false, true]) {
    const scored: Scored[] = located
      .filter(({ p }) => {
        if (!anyCat && !STYLE_CATS[style].includes(p.cat) && !(style === "scenic" && SCENIC_EXTRA.has(p.kind)))
          return false;
        return !!p.name || style === "surprise" || wander === 11;
      })
      .map((c) => {
        const { p } = c;
        let v = p.score * 0.6;
        // Places we can actually show and tell about come first: photo, article, description.
        if (p.image) v += 1.5;
        if (p.wikipedia || p.wikidata) v += 1.2;
        if (p.description || p.detail) v += 0.6;
        const rarity = 1 / Math.log2(1 + (kindCount.get(p.kind) ?? 1)); // 1 = only one of its kind here
        if (wander === 11) {
          // Wild detours must pay off: famous, photographed, well-documented places, plus some rarity.
          v += p.popularity * 1.3 + rarity * 1.5 + random() * (1.2 + W.weird);
        } else if (style === "surprise") {
          // Hidden gems: rare kinds, and places nobody has written a Wikipedia article about.
          v += rarity * 4 - p.popularity * 0.35 + random() * (1.2 + W.weird);
        } else {
          // Scenic & historic: the well-known highlights first.
          v += p.popularity * 0.9 + (style === "scenic" ? (SCENIC_BONUS[p.kind] ?? 0) : 0) + random() * (0.8 + W.weird);
        }
        // Prefer sights right on the way; level 11 doesn't care.
        if (wander !== 11) v -= (c.dev / maxDev) * 1.5;
        return { ...c, v };
      })
      .sort((a, b) => b.v - a.v);
    if (!scored.length) continue;

    const spacing = (L / (maxStops + 1)) * 0.6;
    const chosen: Scored[] = [];
    let used = 0;
    for (const c of scored) {
      if (chosen.length >= maxStops) break;
      if (used + 2 * c.dev > budget) continue;
      if (chosen.some((o) => Math.abs(o.along - c.along) < spacing || Math.hypot(o.p.x - c.p.x, o.p.y - c.p.y) < 80))
        continue;
      // Two unnamed stops would both be called e.g. "Näköalapaikka" — keep one.
      if (!c.p.name && chosen.some((o) => (o.p.name ?? o.p.kind) === c.p.kind)) continue;
      chosen.push(c);
      used += 2 * c.dev;
    }
    if (chosen.length) return chosen.sort((a, b) => a.along - b.along);
  }
  return [];
}

/** A place for a fixed stop coordinate: the known POI within 60 m, or an unnamed waypoint. */
export function poiAt(pois: Poi[], ll: LngLat, x: number, y: number, i: number): Poi {
  let best: Poi | null = null;
  let bestD = 60;
  for (const p of pois) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return (
    best ?? { id: `fixed:${i}`, cat: "curio", kind: "Pysähdys", lngLat: ll, score: 0, popularity: 0, x, y }
  );
}

function fixedScored(g: Graph, fixed: LngLat[]): Scored[] {
  return fixed.map((ll, i) => ({ p: poiAt(g.pois, ll, g.proj.x(ll[0]), g.proj.y(ll[1]), i), v: 1, dev: 0, along: i }));
}

export function toMidstop(p: Poi): Midstop {
  return {
    id: p.id,
    lngLat: p.lngLat,
    name: p.name ?? p.kind,
    kind: p.kind,
    cat: p.cat,
    // Short factual line first, then the friendly fallback; Wikipedia text replaces both when available.
    // Only real information: OSM description and tag facts. Wikipedia/Wikidata text replaces it later.
    blurb: [p.description, p.detail].filter(Boolean).join(" ") || undefined,
    wikipedia: p.wikipedia,
    wikidata: p.wikidata,
    image: p.image,
  };
}

export function midpointStop(coords: LngLat[]): Midstop {
  return {
    id: "midpoint",
    lngLat: coords[Math.floor(coords.length / 2)],
    name: "Matkan puoliväli",
    kind: "Taukopaikka",
    cat: "curio",
    blurb:
      "Tältä alueelta ei löytynyt kartoitettuja nähtävyyksiä – katso ympärillesi, ehkä löydät jotain, mitä kukaan ei ole vielä kartoittanut.",
  };
}

/** Same format as the stats bar: "45 min", "1 h 5 min", "6 h". */
export function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

const listFi = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ja ${xs[xs.length - 1]}`;

export function tellStory(
  style: AdventureStyle,
  minutes: number,
  fastMinutes: number,
  stops: Midstop[],
  others: number,
  greenShare?: number,
  waterMeters?: number,
): string {
  // Same rounding as the stats shown next to the story, so the numbers agree.
  const extra = Math.max(1, Math.round(minutes)) - Math.max(1, Math.round(fastMinutes));
  const extraText =
    extra <= 0
      ? "Yhtä nopea kuin suorin reitti"
      : `${extra <= 8 ? "Vain " : ""}${fmtDuration(extra)} pidempi kuin suorin reitti`;
  const names = stops.filter((s) => s.id !== "midpoint").map((s) => s.name);
  const list =
    names.length > 3 ? `${names.slice(0, 3).join(", ")} ja muita` : names.length > 1 ? listFi(names) : names[0];
  const more =
    names.length > 3 || !others
      ? ""
      : others === 1
        ? " – ja yksi muu kohde matkan varrella"
        : ` – ja ${others} muuta kohdetta matkan varrella`;
  if (style === "scenic") {
    const green =
      greenShare !== undefined && greenShare > 0.05
        ? `, ${Math.round(greenShare * 100)} % matkasta vihreän keskellä${waterMeters && waterMeters > 80 ? ` ja ${Math.round(waterMeters / 10) * 10} m veden äärellä` : ""}`
        : "";
    return `${extraText}${green}.${list ? ` Matkalla ${list}.` : ""}`;
  }
  if (style === "historic") return `${extraText}.${list ? ` Matkalla ${list}${more}.` : ""}`;
  return `${extraText}.${list ? ` Pysähdykset, joita et osannut odottaa: ${list}${more}.` : ""}`;
}

/** Join legs into one line. The route stays on roads: each leg already ends at the stop's nearest walkable point. */
export function joinLegs(legs: LngLat[][], _stops: LngLat[] = []): LngLat[] {
  void _stops;
  const out: LngLat[] = [];
  for (const leg of legs) out.push(...(out.length ? leg.slice(1) : leg));
  return out;
}

export function computeAdventure(
  g: Graph,
  from: LngLat,
  to: LngLat,
  style: AdventureStyle,
  random: () => number = Math.random,
  wander: Wander = 2,
  /** Exact stops (e.g. from a shared link): skip selection and route through these in order. */
  fixed?: LngLat[],
): Adventure {
  const s = nearestNode(g, from);
  const t = nearestNode(g, to);
  if (s < 0 || t < 0)
    throw new AdventureError("Pistettä ei löytynyt kävelyteiden läheltä. Valitse kohta lähempää katua tai polkua.");
  if (s === t) throw new AdventureError("Lähtö ja määränpää ovat samassa paikassa. Valitse määränpää kauempaa.");
  if (snapDistance(g, from, s) > 300 || snapDistance(g, to, t) > 300)
    throw new AdventureError(
      "Valitsemasi kohta on vedessä tai kaukana kävelyteistä. Valitse kohta lähempää katua tai polkua.",
    );

  const W = WANDER[wander];
  const fastCost = edgeCosts(g, "fast", 1);
  const fastPath = shortestPath(g, fastCost, s, t);
  if (!fastPath)
    throw new AdventureError("Pisteiden välille ei löytynyt kävelyreittiä. Kokeile toista kohtaa.", "no-path");
  const fastLen = pathLength(g, fastPath);
  if (fastLen < 150)
    throw new AdventureError("Matka on niin lyhyt, ettei siihen mahdu harharetkeä. Valitse määränpää vähän kauempaa.");
  const fastStats = computeStats(g, fastPath);
  const limit = fastLen * (1 + W.budget * 1.5) + 250;
  const fastLine = lineOf(
    fastPath.map((i) => g.nx[i]),
    fastPath.map((i) => g.ny[i]),
  );

  // Candidate stops near the fastest route, keeping only those with a walkable node nearby.
  const chosenStops = fixed?.length ? fixedScored(g, fixed) : selectStops(g.pois, fastLine, style, wander, random);
  let picked = chosenStops
    .map((c) => ({ ...c, node: nearestNode(g, c.p.lngLat) }))
    .filter(
      (c) =>
        c.node >= 0 && c.node !== s && c.node !== t && Math.hypot(g.nx[c.node] - c.p.x, g.ny[c.node] - c.p.y) < 200,
    );

  // Scenic preference strength by level: gentle at 1, full from 3 up; the last option is plain distance.
  const scenicSteps = wander === 1 ? [0.35, 0.15, 0] : wander === 2 ? [0.7, 0.4, 0.15, 0] : [1, 0.5, 0.2, 0];
  const costs =
    style === "scenic" ? scenicSteps.map((k) => edgeCosts(g, "scenic", k)) : [edgeCosts(g, "surprise", 1)];

  const chain = (cost: Float32Array, nodes: number[]): { legs: number[][] } | { fail: number } => {
    const used = new Set<number>();
    const legs: number[][] = [];
    const stops = [s, ...nodes, t];
    for (let i = 0; i + 1 < stops.length; i++) {
      if (stops[i] === stops[i + 1]) {
        legs.push([stops[i]]);
        continue;
      }
      const leg = shortestPath(g, cost, stops[i], stops[i + 1], used);
      if (!leg) return { fail: Math.min(i, nodes.length - 1) };
      for (const e of pathEdges(g, leg)) used.add(e);
      legs.push(leg);
    }
    return { legs };
  };

  let legs: number[][] | null = null;
  for (;;) {
    const nodes = picked.map((c) => c.node);
    let unreachable = -1;
    // Try each cost (e.g. full-strength scenic, then milder); take the first that fits the limit.
    let shortest: { legs: number[][]; len: number } | null = null;
    for (const cost of costs) {
      const r = chain(cost, nodes);
      if ("fail" in r) {
        unreachable = r.fail;
        break;
      }
      const l: number[][] = r.legs;
      const len = l.reduce((a, leg) => a + pathLength(g, leg), 0);
      if (len <= limit || fixed?.length) {
        legs = l;
        break;
      }
      if (!shortest || len < shortest.len) shortest = { legs: l, len };
    }
    if (legs) break;
    // Nothing fits, and no stop left to drop: take the shortest candidate rather than the first.
    if (unreachable < 0 && picked.length <= 1 && shortest) {
      legs = shortest.legs;
      break;
    }
    if (unreachable >= 0 && picked.length) {
      // A stop on an island or behind a fence: skip it.
      picked = picked.filter((_, i) => i !== unreachable);
      continue;
    }
    if (picked.length <= 1) break;
    // Too long: drop the least interesting stop and try again.
    const worst = picked.reduce((w, c) => (c.v < w.v ? c : w));
    picked = picked.filter((c) => c !== worst);
  }
  if (!legs) {
    legs = [fastPath];
    picked = [];
  }

  const path = legs.reduce<number[]>((acc, leg) => (acc.length ? acc.concat(leg.slice(1)) : leg.slice()), []);
  const stats = computeStats(g, path);
  const stopIds = new Set(picked.map((c) => c.p.id));
  const along = poisAlong(g, path, 35).filter((p) => !stopIds.has(p.id) && p.score >= 2.6);
  const coords = joinLegs(
    legs.map((leg) => toCoords(g, leg)),
    picked.map((c) => c.p.lngLat),
  );

  let stops = picked.map((c) => toMidstop(c.p));
  let others = along;
  if (!stops.length) {
    // Nothing planned: promote the best curiosity on the way — not one right at the start or goal,
    // preferably of the chosen style — and stop counting it as "another" place.
    const clearM = Math.max(100, fastLen * 0.08);
    const away = (p: Poi) =>
      Math.hypot(p.x - g.nx[s], p.y - g.ny[s]) > clearM && Math.hypot(p.x - g.nx[t], p.y - g.ny[t]) > clearM;
    const pool = along.filter(away).sort((a, b) => b.score + (styleFits(style, a) ? 2 : 0) - (a.score + (styleFits(style, b) ? 2 : 0)));
    const best = pool[0];
    others = best ? along.filter((p) => p !== best) : along;
    stops = [best ? toMidstop(best) : midpointStop(coords)];
  }

  const spur = 0;
  const minutes = stats.minutes + spur / 75;

  return {
    style,
    wander,
    coords,
    stops,
    midstop: stops[0],
    distanceM: Math.round(stats.length + spur),
    durationMin: Math.max(1, Math.round(minutes)),
    fastMin: Math.max(1, Math.round(fastStats.minutes)),
    fastCoords: toCoords(g, fastPath),
    story: tellStory(style, minutes, fastStats.minutes, stops, others.length, stats.greenShare, stats.waterMeters),
    pois: others.map((p) => ({ id: p.id, lngLat: p.lngLat, name: p.name, kind: p.kind })),
    stats: {
      greenShare: stats.greenShare,
      waterMeters: Math.round(stats.waterMeters),
      steps: stats.steps,
      turns: stats.turns,
    },
    startSnapped: [g.lng[s], g.lat[s]],
    endSnapped: [g.lng[t], g.lat[t]],
  };
}
