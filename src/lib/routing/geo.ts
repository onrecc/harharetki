export type LngLat = [lng: number, lat: number];

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Local equirectangular projection to metres — accurate enough within a few kilometres. */
export class Projector {
  readonly kx: number;
  readonly ky = 110574;
  readonly lat0: number;
  readonly lng0: number;
  constructor(lat0: number, lng0: number) {
    this.lat0 = lat0;
    this.lng0 = lng0;
    this.kx = 111320 * Math.cos(toRad(lat0));
  }
  x(lng: number) {
    return (lng - this.lng0) * this.kx;
  }
  y(lat: number) {
    return (lat - this.lat0) * this.ky;
  }
}

/** Uniform hash grid for fast proximity lookups. */
export class Grid<T> {
  private cells = new Map<number, T[]>();
  readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  private key(cx: number, cy: number) {
    return (cx + 50000) * 100000 + (cy + 50000);
  }
  add(x: number, y: number, item: T) {
    const k = this.key(Math.floor(x / this.size), Math.floor(y / this.size));
    const cell = this.cells.get(k);
    if (cell) cell.push(item);
    else this.cells.set(k, [item]);
  }
  addRect(x0: number, y0: number, x1: number, y1: number, item: T) {
    const s = this.size;
    for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++)
      for (let cy = Math.floor(y0 / s); cy <= Math.floor(y1 / s); cy++) {
        const k = this.key(cx, cy);
        const cell = this.cells.get(k);
        if (cell) cell.push(item);
        else this.cells.set(k, [item]);
      }
  }
  /** Items in cells overlapping a square of radius r around (x, y). */
  near(x: number, y: number, r: number, out: T[] = []): T[] {
    const s = this.size;
    for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++)
      for (let cy = Math.floor((y - r) / s); cy <= Math.floor((y + r) / s); cy++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (cell) for (const it of cell) out.push(it);
      }
    return out;
  }
}

export function pointInRing(x: number, y: number, xs: Float64Array, ys: Float64Array): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if (ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i])
      inside = !inside;
  }
  return inside;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
