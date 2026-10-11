import type { LngLat, MapPadding, PaddingProp } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A line with precomputed cumulative distances, for fast slicing/sampling. */
export type MeasuredLine = { coords: LngLat[]; cum: number[]; length: number };

export function measure(coords: LngLat[]): MeasuredLine {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + distanceM(coords[i - 1], coords[i]));
  }
  return { coords, cum, length: cum[cum.length - 1] ?? 0 };
}

function segmentAt(line: MeasuredLine, d: number): number {
  // Binary search: last index i with cum[i] <= d.
  let lo = 0;
  let hi = line.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Point `d` metres along the line (clamped). */
export function pointAt(line: MeasuredLine, d: number): LngLat {
  const { coords, cum } = line;
  if (coords.length === 0) return [0, 0];
  if (d <= 0) return coords[0];
  if (d >= line.length) return coords[coords.length - 1];
  const i = segmentAt(line, d);
  const a = coords[i];
  const b = coords[i + 1] ?? a;
  const seg = cum[i + 1] - cum[i] || 1;
  const t = (d - cum[i]) / seg;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The first `d` metres of the line; always at least two points. */
export function sliceTo(line: MeasuredLine, d: number): LngLat[] {
  const { coords } = line;
  if (coords.length < 2) return coords.length ? [coords[0], coords[0]] : [];
  if (d >= line.length) return coords;
  const i = segmentAt(line, Math.max(0, d));
  return [...coords.slice(0, i + 1), pointAt(line, d)];
}

/** Bounds as [[minLng, minLat], [maxLng, maxLat]], or null for no points. */
export function boundsOf(
  lines: LngLat[][],
): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const [x, y] of line) {
      // Skip junk points ([0,0], NaN) that would blow the bounds up to half the planet.
      if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) continue;
      if (Math.abs(x) > 180 || Math.abs(y) > 90) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? null : [[minX, minY], [maxX, maxY]];
}

/** Padding that keeps content clear of the planner UI: left sidebar on desktop, bottom sheet on mobile. */
export function defaultPadding(): MapPadding {
  if (typeof window === "undefined") return { top: 60, right: 60, bottom: 60, left: 60 };
  if (window.innerWidth >= 768) return { top: 60, right: 60, bottom: 60, left: 420 };
  return { top: 60, right: 40, bottom: Math.round(window.innerHeight * 0.45), left: 40 };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function resolvePadding(p: PaddingProp | undefined): MapPadding {
  if (!p) return defaultPadding();
  return typeof p === "function" ? p() : p;
}
