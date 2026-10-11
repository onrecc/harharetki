import type { LngLat } from "./geo";

export type ManeuverType =
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "uturn"
  | "stop"
  | "arrive";

export interface Maneuver {
  at: LngLat;
  /** Metres from the route start. */
  along: number;
  type: ManeuverType;
  /** Finnish instruction, e.g. "Käänny oikealle". */
  text: string;
  icon: string;
}

const TEXT: Record<ManeuverType, [string, string]> = {
  left: ["Käänny vasemmalle", "↰"],
  right: ["Käänny oikealle", "↱"],
  "slight-left": ["Pidä vasemmalla", "↖"],
  "slight-right": ["Pidä oikealla", "↗"],
  "sharp-left": ["Käänny jyrkästi vasemmalle", "⤺"],
  "sharp-right": ["Käänny jyrkästi oikealle", "⤻"],
  uturn: ["Käänny takaisin", "↶"],
  stop: ["Pysähdys", "📍"],
  arrive: ["Perillä", "🏁"],
};

/** Local metric projection around a reference latitude. */
function projector(lat0: number) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return (p: LngLat) => [p[0] * kx, p[1] * ky] as const;
}

/**
 * Turn instructions derived from the route geometry: heading changes measured over ~15 m on
 * either side of each vertex, so tiny zig-zags along a sidewalk don't count as turns.
 */
export function buildManeuvers(coords: LngLat[], stops: { lngLat: LngLat; name: string }[] = []): Maneuver[] {
  if (coords.length < 2) return [];
  const P = projector(coords[0][1]);
  const pts = coords.map(P);
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];

  // Point on the line `d` metres along.
  const at = (d: number): readonly [number, number] => {
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };

  const out: Maneuver[] = [];
  const LOOK = 15;
  let lastAlong = -Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = cum[i];
    if (d < LOOK || d > total - LOOK) continue;
    if (d - lastAlong < 20) continue; // one instruction per corner
    const a = at(d - LOOK);
    const b = pts[i];
    const c = at(d + LOOK);
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let delta = ((h2 - h1) * 180) / Math.PI;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    const abs = Math.abs(delta);
    if (abs < 30) continue;
    // Counter-clockwise (positive) is a left turn in an x-east / y-north frame.
    const left = delta > 0;
    const type: ManeuverType =
      abs > 160 ? "uturn" : abs > 120 ? (left ? "sharp-left" : "sharp-right") : abs > 50 ? (left ? "left" : "right") : left ? "slight-left" : "slight-right";
    const [text, icon] = TEXT[type];
    out.push({ at: coords[i], along: d, type, text, icon });
    lastAlong = d;
  }

  // Stops, placed where the route passes closest to them.
  for (const s of stops) {
    const sp = P(s.lngLat);
    let best = Infinity;
    let bestAlong = 0;
    for (let i = 0; i < pts.length; i++) {
      const dd = Math.hypot(pts[i][0] - sp[0], pts[i][1] - sp[1]);
      if (dd < best) {
        best = dd;
        bestAlong = cum[i];
      }
    }
    out.push({ at: s.lngLat, along: bestAlong, type: "stop", text: `Pysähdys: ${s.name}`, icon: TEXT.stop[1] });
  }
  out.push({ at: coords[coords.length - 1], along: total, type: "arrive", text: TEXT.arrive[0], icon: TEXT.arrive[1] });
  // Drop turns that fall within a few metres of a stop (the stop is the better instruction).
  const stopsAlong = out.filter((m) => m.type === "stop").map((m) => m.along);
  return out
    .filter((m) => m.type === "stop" || m.type === "arrive" || !stopsAlong.some((a) => Math.abs(a - m.along) < 12))
    .sort((x, y) => x.along - y.along);
}

/** Where the user is along the route (metres from start) and how far off the line they are. */
export function routeProgress(coords: LngLat[], pos: LngLat): { along: number; offRoute: number } {
  if (coords.length < 2) return { along: 0, offRoute: Infinity };
  const P = projector(coords[0][1]);
  const [px, py] = P(pos);
  let cum = 0;
  let bestD = Infinity;
  let bestAlong = 0;
  let prev = P(coords[0]);
  for (let i = 1; i < coords.length; i++) {
    const cur = P(coords[i]);
    const dx = cur[0] - prev[0];
    const dy = cur[1] - prev[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - prev[0]) * dx + (py - prev[1]) * dy) / l2)) : 0;
    const d = Math.hypot(px - (prev[0] + t * dx), py - (prev[1] + t * dy));
    const len = Math.sqrt(l2);
    if (d < bestD) {
      bestD = d;
      bestAlong = cum + t * len;
    }
    cum += len;
    prev = cur;
  }
  return { along: bestAlong, offRoute: bestD };
}

/** The next instruction ahead of `along` (with a small grace so a corner shows until passed). */
export function nextManeuver(maneuvers: Maneuver[], along: number): { m: Maneuver; dist: number } | null {
  const m = maneuvers.find((x) => x.along > along - 5);
  return m ? { m, dist: Math.max(0, Math.round(m.along - along)) } : null;
}

/** "40 m", "1,2 km". */
export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}
