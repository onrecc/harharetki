import { distToSegment, haversine, type LngLat } from "./geo.ts";
import { Kind, nearestNode, type Graph } from "./graph.ts";
import type { Poi } from "./poi.ts";

export type RouteId = "fast" | "scenic" | "surprise" | "maze";

export interface RouteStats {
  length: number;
  minutes: number;
  greenShare: number;
  waterMeters: number;
  pathShare: number;
  bigRoadShare: number;
  steps: number;
  passages: number;
  turns: number;
  bridges: number;
  streets: number;
}

export interface Route {
  id: RouteId;
  coords: LngLat[];
  stats: RouteStats;
  /** Places passed on the way, in walking order. */
  pois: Poi[];
  extraMinutes: number;
  title: string;
  tagline: string;
  story: string;
  highlights: string[];
}

const WALK_M_PER_MIN = 75;

/** Base price per metre of each street kind for "normal" walking. */
const BASE: Record<number, number> = {
  [Kind.Path]: 1, [Kind.Steps]: 1.15, [Kind.Passage]: 1, [Kind.Alley]: 1,
  [Kind.Pedestrian]: 1, [Kind.Sidewalk]: 1, [Kind.Service]: 1, [Kind.Residential]: 1,
  [Kind.Cycleway]: 1.05, [Kind.Tertiary]: 1.02, [Kind.Secondary]: 1.05, [Kind.Primary]: 1.08,
};

/** The Maze loves the small, odd and hidden; it avoids big streets. */
const MAZE: Record<number, number> = {
  [Kind.Path]: 0.4, [Kind.Steps]: 0.15, [Kind.Passage]: 0.2, [Kind.Alley]: 0.35,
  [Kind.Pedestrian]: 0.55, [Kind.Sidewalk]: 1.1, [Kind.Service]: 0.6, [Kind.Residential]: 0.95,
  [Kind.Cycleway]: 0.9, [Kind.Tertiary]: 1.6, [Kind.Secondary]: 2.4, [Kind.Primary]: 3.2,
};

const ROAD_NOISE: Record<number, number> = {
  [Kind.Path]: 0.85, [Kind.Steps]: 1, [Kind.Passage]: 1.1, [Kind.Alley]: 0.95,
  [Kind.Pedestrian]: 0.9, [Kind.Sidewalk]: 1.15, [Kind.Service]: 1.05, [Kind.Residential]: 1,
  [Kind.Cycleway]: 0.95, [Kind.Tertiary]: 1.3, [Kind.Secondary]: 1.6, [Kind.Primary]: 2,
};

export function edgeCosts(g: Graph, profile: RouteId, strength: number): Float32Array {
  const E = g.edgeLen.length;
  const c = new Float32Array(E);
  for (let e = 0; e < E; e++) {
    const k = g.edgeKind[e] as Kind;
    let f = BASE[k];
    if (profile === "scenic") {
      const s =
        ROAD_NOISE[k] *
        (1 - 0.6 * g.edgeGreen[e] - 0.55 * g.edgeWater[e] - 0.15 * g.edgeBridge[e]);
      f = Math.max(0.15, 1 + strength * (s - 1));
    } else if (profile === "maze") {
      f = Math.max(0.1, 1 + strength * (MAZE[k] - 1));
    } else if (profile === "surprise") {
      f = BASE[k] * (k >= Kind.Secondary ? 1.15 : 1);
    }
    c[e] = g.edgeLen[e] * f;
  }
  return c;
}

/** Binary-heap Dijkstra; returns node path or null. */
export function shortestPath(g: Graph, cost: Float32Array, from: number, to: number, avoid?: Set<number>) {
  const N = g.nx.length;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heapN: number[] = [];
  const heapD: number[] = [];
  const push = (n: number, d: number) => {
    let i = heapN.length;
    heapN.push(n);
    heapD.push(d);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p] <= d) break;
      heapN[i] = heapN[p];
      heapD[i] = heapD[p];
      i = p;
    }
    heapN[i] = n;
    heapD[i] = d;
  };
  const pop = () => {
    const n = heapN[0];
    const lastN = heapN.pop()!;
    const lastD = heapD.pop()!;
    if (heapN.length) {
      let i = 0;
      const len = heapN.length;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= len) break;
        if (m + 1 < len && heapD[m + 1] < heapD[m]) m++;
        if (heapD[m] >= lastD) break;
        heapN[i] = heapN[m];
        heapD[i] = heapD[m];
        i = m;
      }
      heapN[i] = lastN;
      heapD[i] = lastD;
    }
    return n;
  };
  // A* heuristic: straight-line distance times the cheapest possible edge factor.
  const tx = g.nx[to];
  const ty = g.ny[to];
  const h = (n: number) => Math.hypot(g.nx[n] - tx, g.ny[n] - ty) * 0.1;
  dist[from] = 0;
  push(from, h(from));
  const done = new Uint8Array(N);
  while (heapN.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const v = g.adjTo[k];
      if (done[v]) continue;
      const e = g.adjEdge[k];
      const w = cost[e] * (avoid?.has(e) ? 1.6 : 1);
      const nd = dist[u] + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        push(v, nd + h(v));
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const path: number[] = [];
  for (let v = to; v !== -1; v = prev[v]) path.push(v);
  return path.reverse();
}

function edgeBetween(g: Graph, a: number, b: number): number {
  for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) return g.adjEdge[k];
  return -1;
}

export function pathEdges(g: Graph, path: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) out.push(edgeBetween(g, path[i], path[i + 1]));
  return out;
}

export function pathLength(g: Graph, path: number[]) {
  let s = 0;
  for (const e of pathEdges(g, path)) if (e >= 0) s += g.edgeLen[e];
  return s;
}

export function computeStats(g: Graph, path: number[]): RouteStats {
  const edges = pathEdges(g, path);
  let length = 0, green = 0, water = 0, pathM = 0, big = 0, steps = 0, passages = 0, bridges = 0;
  let lastKind = -1;
  let lastBridge = 0;
  const streets = new Set<number>();
  for (const e of edges) {
    if (e < 0) continue;
    const L = g.edgeLen[e];
    const k = g.edgeKind[e] as Kind;
    length += L;
    if (g.edgeGreen[e]) green += L;
    if (g.edgeWater[e]) water += L;
    if (k === Kind.Path || k === Kind.Steps || k === Kind.Passage || k === Kind.Alley || k === Kind.Pedestrian)
      pathM += L;
    if (k >= Kind.Tertiary) big += L;
    if (k === Kind.Steps && lastKind !== Kind.Steps) steps++;
    if (k === Kind.Passage && lastKind !== Kind.Passage) passages++;
    if (g.edgeBridge[e] && !lastBridge) bridges++;
    if (g.edgeName[e] >= 0) streets.add(g.edgeName[e]);
    lastKind = k;
    lastBridge = g.edgeBridge[e];
  }
  // Count real turns: heading changes over 50° measured across ~15 m.
  let turns = 0;
  let prevHeading: number | null = null;
  let ax = g.nx[path[0]];
  let ay = g.ny[path[0]];
  for (let i = 1; i < path.length; i++) {
    const bx = g.nx[path[i]];
    const by = g.ny[path[i]];
    if (Math.hypot(bx - ax, by - ay) < 15) continue;
    const hd = Math.atan2(by - ay, bx - ax);
    if (prevHeading !== null) {
      let d = Math.abs(hd - prevHeading);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > (50 * Math.PI) / 180) turns++;
    }
    prevHeading = hd;
    ax = bx;
    ay = by;
  }
  const safe = Math.max(length, 1);
  return {
    length,
    minutes: length / WALK_M_PER_MIN + steps * 0.3,
    greenShare: green / safe,
    waterMeters: water,
    pathShare: pathM / safe,
    bigRoadShare: big / safe,
    steps,
    passages,
    turns,
    bridges,
    streets: streets.size,
  };
}

/** POIs within `radius` metres of the path, ordered by position along it. */
export function poisAlong(g: Graph, path: number[], radius = 35): Poi[] {
  const found = new Map<number, number>(); // poi index -> distance along
  let along = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const mx = (g.nx[a] + g.nx[b]) / 2;
    const my = (g.ny[a] + g.ny[b]) / 2;
    const segLen = Math.hypot(g.nx[a] - g.nx[b], g.ny[a] - g.ny[b]);
    for (const pi of g.poiGrid.near(mx, my, segLen / 2 + radius)) {
      if (found.has(pi)) continue;
      const p = g.pois[pi];
      if (distToSegment(p.x, p.y, g.nx[a], g.ny[a], g.nx[b], g.ny[b]) <= radius) found.set(pi, along);
    }
    along += segLen;
  }
  const ordered = [...found.entries()].sort((x, y) => x[1] - y[1]).map(([pi]) => g.pois[pi]);
  // Groups of statues etc. share a name — keep the first of each.
  const out: Poi[] = [];
  for (const p of ordered) {
    if (out.some((q) => (p.name ? q.name === p.name : q.kind === p.kind && Math.hypot(q.x - p.x, q.y - p.y) < 40)))
      continue;
    out.push(p);
  }
  return out;
}

/** Pick surprising waypoints inside an ellipse between start and goal. */
function pickWaypoints(g: Graph, s: number, t: number, count: number, slack: number): Poi[] {
  const sx = g.nx[s], sy = g.ny[s], tx = g.nx[t], ty = g.ny[t];
  const D = Math.hypot(tx - sx, ty - sy);
  const limit = D * slack + 250;
  const kindCount = new Map<string, number>();
  for (const p of g.pois) kindCount.set(p.kind, (kindCount.get(p.kind) ?? 0) + 1);
  const candidates = g.pois
    .filter((p) => {
      const d1 = Math.hypot(p.x - sx, p.y - sy);
      const d2 = Math.hypot(p.x - tx, p.y - ty);
      return d1 + d2 <= limit && d1 > 60 && d2 > 60;
    })
    .map((p) => ({ p, s: p.score + 1.5 / Math.log2(1 + (kindCount.get(p.kind) ?? 1)) + Math.random() * 0.8 }))
    .sort((a, b) => b.s - a.s);
  const chosen: Poi[] = [];
  const kinds = new Set<string>();
  for (const { p } of candidates) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < Math.max(120, D / 6))) continue;
    // Prefer variety: one of each kind first.
    if (kinds.has(p.kind) && candidates.length > count * 3) continue;
    chosen.push(p);
    kinds.add(p.kind);
  }
  // Order by projection onto the start→goal line.
  const ux = (tx - sx) / (D || 1);
  const uy = (ty - sy) / (D || 1);
  return chosen.sort((a, b) => (a.x - sx) * ux + (a.y - sy) * uy - ((b.x - sx) * ux + (b.y - sy) * uy));
}

export function toCoords(g: Graph, path: number[]): LngLat[] {
  return path.map((i) => [g.lng[i], g.lat[i]] as LngLat);
}

const fmtMin = (m: number) => `${Math.max(1, Math.round(m))} min`;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const listFi = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ja ${xs[xs.length - 1]}`;

function extraText(extra: number) {
  const m = Math.round(extra);
  if (m <= 0) return "Yhtä nopea kuin suorin reitti";
  return `${m} min pidempi`;
}

function narrate(r: Omit<Route, "title" | "tagline" | "story" | "highlights">, fast: RouteStats): Pick<Route, "title" | "tagline" | "story" | "highlights"> {
  const s = r.stats;
  const extra = extraText(r.extraMinutes);
  const named = r.pois.filter((p) => p.name);
  if (r.id === "fast") {
    return {
      title: "Tavallinen reitti",
      tagline: "Se, jonka navigaattori antaisi",
      story: `Nopein tie perille: ${fmtMin(s.minutes)}. ${pct(s.bigRoadShare)} matkasta isojen katujen varsilla. Toimiva – mutta tylsä.`,
      highlights: [fmtMin(s.minutes), `${(s.length / 1000).toFixed(1)} km`],
    };
  }
  if (r.id === "scenic") {
    const greenGain = s.greenShare - fast.greenShare;
    const water = s.waterMeters > 80 ? ` ja ${Math.round(s.waterMeters / 10) * 10} m veden äärellä` : "";
    return {
      title: "Maisemareitti",
      tagline: "Puistojen, rantojen ja puiden kautta",
      story: `${extra}, mutta ${pct(s.greenShare)} matkasta kulkee vihreän keskellä${water}.${greenGain > 0.1 ? ` Se on ${Math.round(greenGain * 100)} prosenttiyksikköä enemmän kuin tavallisella reitillä.` : ""}`,
      highlights: [
        `${pct(s.greenShare)} vihreää`,
        s.waterMeters > 80 ? `${Math.round(s.waterMeters)} m rantaa` : `${s.bridges} siltaa`,
        `${pct(s.bigRoadShare)} isoja katuja`,
      ],
    };
  }
  if (r.id === "surprise") {
    const names = [...named].sort((a, b) => b.score - a.score).slice(0, 3).map((p) => p.name!);
    const n = r.pois.length;
    return {
      title: "Yllätysreitti",
      tagline: "Paikkoja, joita et ole huomannut",
      story:
        n > 0
          ? `${extra}, mutta matkan varrelle osuu ${n} ${n === 1 ? "kohde" : "kohdetta"}, joiden ohi olet luultavasti kävellyt huomaamatta${names.length ? ` – esimerkiksi ${listFi(names)}` : ""}.`
          : `${extra}. Tältä alueelta ei löytynyt kartoitettuja kohteita – kokeile toista määränpäätä.`,
      highlights: [
        `${n} löytöä`,
        `${new Set(r.pois.map((p) => p.kind)).size} lajia`,
        `${s.streets} katua`,
      ],
    };
  }
  return {
    title: "Labyrintti",
    tagline: "Kujia, portaita ja oikopolkuja",
    story: `${extra}. Unohda pääkadut: ${s.turns} käännöstä, ${s.steps} ${s.steps === 1 ? "portaikko" : "portaikkoa"}${s.passages ? `, ${s.passages} ${s.passages === 1 ? "läpikulku" : "läpikulkua"}` : ""} ja ${pct(s.pathShare)} matkasta poluilla ja kujilla.`,
    highlights: [`${s.turns} käännöstä`, `${s.steps} portaikkoa`, `${pct(s.pathShare)} polkuja`],
  };
}

export interface PlanResult {
  routes: Route[];
  from: LngLat;
  to: LngLat;
}

export class RoutingError extends Error {}

export function planRoutes(g: Graph, from: LngLat, to: LngLat): PlanResult {
  const s = nearestNode(g, from);
  const t = nearestNode(g, to);
  if (s < 0 || t < 0) throw new RoutingError("Pistettä ei löytynyt kävelyteiden läheltä. Valitse kohta lähempää katua tai polkua.");
  if (s === t) throw new RoutingError("Lähtö ja määränpää ovat samassa paikassa. Valitse määränpää kauempaa.");

  const fastCost = edgeCosts(g, "fast", 1);
  const fastPath = shortestPath(g, fastCost, s, t);
  if (!fastPath) throw new RoutingError("Pisteiden välille ei löytynyt kävelyreittiä. Kokeile toista kohtaa.");
  const fastLen = pathLength(g, fastPath);
  const fastStats = computeStats(g, fastPath);
  const maxLen = (factor: number) => fastLen * factor + 400;

  // Scenic & Maze: weaken the preference until the detour is reasonable.
  const tuned = (profile: "scenic" | "maze") => {
    for (const strength of [1, 0.7, 0.45, 0.25]) {
      const p = shortestPath(g, edgeCosts(g, profile, strength), s, t);
      if (p && pathLength(g, p) <= maxLen(1.7)) return p;
    }
    return fastPath;
  };
  const scenicPath = tuned("scenic");
  const mazePath = tuned("maze");

  // Surprise: chain shortest paths through hand-picked curiosities.
  const surpriseCost = edgeCosts(g, "surprise", 1);
  const wantCount = Math.min(4, Math.max(2, Math.round(fastLen / 600)));
  let surprisePath: number[] = fastPath;
  for (let count = wantCount, slack = 1.3; count >= 1; count--, slack -= 0.06) {
    const wps = pickWaypoints(g, s, t, count, slack);
    if (!wps.length) continue;
    const stops = [s, ...wps.map((p) => nearestNode(g, p.lngLat)).filter((n) => n >= 0), t];
    const full: number[] = [];
    const used = new Set<number>();
    let ok = true;
    for (let i = 0; i + 1 < stops.length; i++) {
      if (stops[i] === stops[i + 1]) continue;
      const seg = shortestPath(g, surpriseCost, stops[i], stops[i + 1], used);
      if (!seg) {
        ok = false;
        break;
      }
      for (const e of pathEdges(g, seg)) used.add(e);
      full.push(...(full.length ? seg.slice(1) : seg));
    }
    if (ok && pathLength(g, full) <= maxLen(1.6)) {
      surprisePath = full;
      break;
    }
  }

  const make = (id: RouteId, path: number[]): Route => {
    const stats = computeStats(g, path);
    const base = {
      id,
      coords: toCoords(g, path),
      stats,
      pois: poisAlong(g, path, id === "surprise" ? 40 : 30).filter((p) => p.score >= 2.6),
      extraMinutes: stats.minutes - fastStats.minutes,
    };
    return { ...base, ...narrate(base, fastStats) };
  };

  return {
    routes: [make("scenic", scenicPath), make("surprise", surprisePath), make("maze", mazePath), make("fast", fastPath)],
    from,
    to,
  };
}

export function straightDistance(a: LngLat, b: LngLat) {
  return haversine(a, b);
}
