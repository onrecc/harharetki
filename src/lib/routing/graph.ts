import { Grid, Projector, distToSegment, pointInRing, type LngLat } from "./geo.ts";
import { classifyPoi, type Poi } from "./poi.ts";

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  center?: { lat: number; lon: number };
}

export interface OsmResponse {
  elements: OsmElement[];
  bbox?: [number, number, number, number];
}

/** Edge kinds, used by route profiles to price each street segment. */
export const Kind = {
  Path: 0,
  Steps: 1,
  Passage: 2,
  Alley: 3,
  Pedestrian: 4,
  Sidewalk: 5,
  Service: 6,
  Residential: 7,
  Cycleway: 8,
  Tertiary: 9,
  Secondary: 10,
  Primary: 11,
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

function kindOf(t: Record<string, string>): Kind {
  const h = t.highway;
  if (h === "steps") return Kind.Steps;
  if (h === "corridor" || t.tunnel === "yes" || t.tunnel === "building_passage" || t.covered === "yes")
    return Kind.Passage;
  if (h === "footway" && (t.footway === "sidewalk" || t.footway === "crossing")) return Kind.Sidewalk;
  if (h === "footway" || h === "path" || h === "track" || h === "bridleway") return Kind.Path;
  if (h === "pedestrian") return Kind.Pedestrian;
  if (h === "living_street" || (h === "service" && t.service === "alley")) return Kind.Alley;
  if (h === "service") return Kind.Service;
  if (h === "cycleway") return Kind.Cycleway;
  if (h === "tertiary" || h === "tertiary_link") return Kind.Tertiary;
  if (h === "secondary" || h === "secondary_link") return Kind.Secondary;
  if (h === "primary" || h === "primary_link") return Kind.Primary;
  return Kind.Residential;
}

export interface Graph {
  proj: Projector;
  /** Node coordinates (projected metres and lng/lat). */
  nx: Float64Array;
  ny: Float64Array;
  lng: Float64Array;
  lat: Float64Array;
  /** CSR adjacency: edges of node i are adjStart[i]..adjStart[i+1]. */
  adjStart: Int32Array;
  adjTo: Int32Array;
  adjEdge: Int32Array;
  /** Per undirected edge attributes. */
  edgeLen: Float32Array;
  edgeKind: Uint8Array;
  edgeGreen: Uint8Array;
  edgeWater: Uint8Array;
  edgeBridge: Uint8Array;
  nodeGrid: Grid<number>;
  /** Size of the connected component each node belongs to (tiny ones are mapping fragments). */
  compSize: Int32Array;
  pois: Poi[];
  poiGrid: Grid<number>;
  /** Street names per edge (index into names), for the narrative. */
  edgeName: Int32Array;
  names: string[];
}

const GREEN_LEISURE = /^(park|garden|nature_reserve|playground|dog_park)$/;
const GREEN_LANDUSE = /^(grass|forest|meadow|recreation_ground|cemetery|allotments|village_green|orchard)$/;
const GREEN_NATURAL = /^(wood|scrub|grassland|heath|wetland)$/;

export function buildGraph(data: OsmResponse): Graph {
  const els = data.elements;

  // 1. Coordinates of every node returned.
  const coord = new Map<number, [number, number]>();
  let sumLat = 0;
  let sumLng = 0;
  let n = 0;
  for (const e of els) {
    if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) {
      coord.set(e.id, [e.lon, e.lat]);
      if (n < 5000) {
        sumLat += e.lat;
        sumLng += e.lon;
        n++;
      }
    }
  }
  const proj = new Projector(sumLat / Math.max(n, 1), sumLng / Math.max(n, 1));

  // 2. Classify elements.
  const roads: OsmElement[] = [];
  const greenRings: { xs: Float64Array; ys: Float64Array; box: number[] }[] = [];
  const waterGrid = new Grid<[number, number]>(60);
  const pois: Poi[] = [];
  const seenPoi = new Set<string>();

  const addWaterLine = (geom: { lat: number; lon: number }[]) => {
    for (let i = 0; i < geom.length; i++) {
      const x = proj.x(geom[i].lon);
      const y = proj.y(geom[i].lat);
      waterGrid.add(x, y, [x, y]);
      if (i + 1 < geom.length) {
        // Densify long segments so proximity checks stay accurate.
        const x2 = proj.x(geom[i + 1].lon);
        const y2 = proj.y(geom[i + 1].lat);
        const steps = Math.floor(Math.hypot(x2 - x, y2 - y) / 25);
        for (let s = 1; s < steps; s++) {
          const px = x + ((x2 - x) * s) / steps;
          const py = y + ((y2 - y) * s) / steps;
          waterGrid.add(px, py, [px, py]);
        }
      }
    }
  };

  for (const e of els) {
    const t = e.tags;
    if (!t) continue;
    if (e.type === "way" && e.nodes && t.highway && !e.geometry) {
      roads.push(e);
      continue;
    }
    if (e.type === "way" && e.geometry) {
      const isWater =
        t.natural === "water" || t.natural === "coastline" || t.natural === "beach" || !!t.waterway;
      const isGreen =
        GREEN_LEISURE.test(t.leisure ?? "") ||
        GREEN_LANDUSE.test(t.landuse ?? "") ||
        GREEN_NATURAL.test(t.natural ?? "");
      if (isWater) addWaterLine(e.geometry);
      if (isGreen && e.geometry.length > 3) {
        const xs = new Float64Array(e.geometry.map((g) => proj.x(g.lon)));
        const ys = new Float64Array(e.geometry.map((g) => proj.y(g.lat)));
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < xs.length; i++) {
          x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]);
          y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]);
        }
        greenRings.push({ xs, ys, box: [x0, y0, x1, y1] });
      }
      continue;
    }
    // Points of interest: tagged nodes, or ways/relations with a center.
    const p =
      e.type === "node" && e.lat !== undefined
        ? { lat: e.lat, lon: e.lon! }
        : e.center;
    if (!p) continue;
    const poi = classifyPoi(e.type, e.id, t, [p.lon, p.lat]);
    if (!poi) continue;
    const key = `${poi.name ?? poi.id}|${Math.round(p.lat * 2000)}|${Math.round(p.lon * 2000)}`;
    if (seenPoi.has(key)) continue;
    seenPoi.add(key);
    pois.push(poi);
  }

  const greenGrid = new Grid<number>(120);
  greenRings.forEach((r, i) => greenGrid.addRect(r.box[0], r.box[1], r.box[2], r.box[3], i));

  // 3. Node indices for nodes used by roads.
  const index = new Map<number, number>();
  const lngs: number[] = [];
  const lats: number[] = [];
  const idx = (id: number) => {
    let i = index.get(id);
    if (i === undefined) {
      const c = coord.get(id)!;
      i = lngs.length;
      index.set(id, i);
      lngs.push(c[0]);
      lats.push(c[1]);
    }
    return i;
  };

  const ea: number[] = [];
  const eb: number[] = [];
  const kinds: number[] = [];
  const bridges: number[] = [];
  const nameIdx: number[] = [];
  const names: string[] = [];
  const nameMap = new Map<string, number>();
  for (const w of roads) {
    const t = w.tags!;
    const kind = kindOf(t);
    const bridge = t.bridge && t.bridge !== "no" ? 1 : 0;
    let ni = -1;
    if (t.name) {
      ni = nameMap.get(t.name) ?? -1;
      if (ni < 0) {
        ni = names.length;
        names.push(t.name);
        nameMap.set(t.name, ni);
      }
    }
    const ns = w.nodes!;
    for (let i = 0; i + 1 < ns.length; i++) {
      if (!coord.has(ns[i]) || !coord.has(ns[i + 1])) continue;
      ea.push(idx(ns[i]));
      eb.push(idx(ns[i + 1]));
      kinds.push(kind);
      bridges.push(bridge);
      nameIdx.push(ni);
    }
  }

  const N = lngs.length;
  const E = ea.length;
  const nx = new Float64Array(N);
  const ny = new Float64Array(N);
  const lng = Float64Array.from(lngs);
  const lat = Float64Array.from(lats);
  const nodeGrid = new Grid<number>(80);
  for (let i = 0; i < N; i++) {
    nx[i] = proj.x(lng[i]);
    ny[i] = proj.y(lat[i]);
    nodeGrid.add(nx[i], ny[i], i);
  }

  const edgeLen = new Float32Array(E);
  const edgeKind = Uint8Array.from(kinds);
  const edgeBridge = Uint8Array.from(bridges);
  const edgeGreen = new Uint8Array(E);
  const edgeWater = new Uint8Array(E);
  const deg = new Int32Array(N + 1);
  const scratch: number[] = [];
  const scratchW: [number, number][] = [];
  for (let e = 0; e < E; e++) {
    const a = ea[e];
    const b = eb[e];
    edgeLen[e] = Math.hypot(nx[a] - nx[b], ny[a] - ny[b]);
    deg[a]++;
    deg[b]++;
    const mx = (nx[a] + nx[b]) / 2;
    const my = (ny[a] + ny[b]) / 2;
    scratch.length = 0;
    for (const gi of greenGrid.near(mx, my, 0, scratch)) {
      const r = greenRings[gi];
      if (mx < r.box[0] || mx > r.box[2] || my < r.box[1] || my > r.box[3]) continue;
      if (pointInRing(mx, my, r.xs, r.ys)) {
        edgeGreen[e] = 1;
        break;
      }
    }
    scratchW.length = 0;
    for (const [wx, wy] of waterGrid.near(mx, my, 70, scratchW)) {
      if (distToSegment(wx, wy, nx[a], ny[a], nx[b], ny[b]) < 70) {
        edgeWater[e] = 1;
        break;
      }
    }
  }

  const adjStart = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) adjStart[i + 1] = adjStart[i] + deg[i];
  const fill = adjStart.slice(0, N);
  const adjTo = new Int32Array(2 * E);
  const adjEdge = new Int32Array(2 * E);
  for (let e = 0; e < E; e++) {
    const a = ea[e];
    const b = eb[e];
    adjTo[fill[a]] = b;
    adjEdge[fill[a]++] = e;
    adjTo[fill[b]] = a;
    adjEdge[fill[b]++] = e;
  }

  const poiGrid = new Grid<number>(100);
  pois.forEach((p, i) => {
    p.x = proj.x(p.lngLat[0]);
    p.y = proj.y(p.lngLat[1]);
    poiGrid.add(p.x, p.y, i);
  });

  return {
    proj, nx, ny, lng, lat, adjStart, adjTo, adjEdge,
    edgeLen, edgeKind, edgeGreen, edgeWater, edgeBridge,
    nodeGrid, pois, poiGrid, edgeName: Int32Array.from(nameIdx), names,
    compSize: componentSizes(N, adjStart, adjTo),
  };
}

/** Nearest graph node to a point (searching outward up to ~1 km). */
function componentSizes(N: number, adjStart: Int32Array, adjTo: Int32Array): Int32Array {
  const comp = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (let k = adjStart[u]; k < adjStart[u + 1]; k++) {
        const v = adjTo[k];
        if (comp[v] < 0) {
          comp[v] = id;
          stack.push(v);
        }
      }
    }
    sizes.push(size);
  }
  const out = new Int32Array(N);
  for (let i = 0; i < N; i++) out[i] = sizes[comp[i]];
  return out;
}

/** Below this, a connected piece is a mapping fragment (a lone courtyard path), not the street network. */
const MAIN_NETWORK = 200;

/**
 * Nearest graph node to a point (searching outward up to ~1 km), preferring the main street
 * network over tiny disconnected fragments a few metres away.
 */
export function nearestNode(g: Graph, p: LngLat): number {
  const x = g.proj.x(p[0]);
  const y = g.proj.y(p[1]);
  let anyBest = -1;
  let anyD = Infinity;
  for (let r = 80; r <= 1280; r *= 2) {
    let best = -1;
    let bestD = Infinity;
    for (const i of g.nodeGrid.near(x, y, r)) {
      if (g.adjStart[i + 1] === g.adjStart[i]) continue;
      const d = Math.hypot(g.nx[i] - x, g.ny[i] - y);
      if (d < anyD) {
        anyD = d;
        anyBest = i;
      }
      if (g.compSize[i] >= MAIN_NETWORK && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // A fragment much closer than the main network (a small island) is what the user meant.
    if (best >= 0 && bestD <= r) return bestD - anyD > 150 ? anyBest : best;
  }
  // Only fragments around (e.g. a small island): use the closest anyway.
  return anyD <= 1280 ? anyBest : -1;
}

/** Straight-line metres from a point to a graph node. */
export function snapDistance(g: Graph, p: LngLat, node: number): number {
  return Math.hypot(g.nx[node] - g.proj.x(p[0]), g.ny[node] - g.proj.y(p[1]));
}
