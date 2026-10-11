import { buildGraph, type Graph, type OsmResponse } from "@/lib/routing/graph";
import { haversine, type LngLat } from "@/lib/routing/geo";
import { buildQuery, type BBox } from "./query";
import { overpass, OverpassError } from "./overpass";

/** Pre-fetched OSM data for central Helsinki (see scripts/fetch-demo.mjs). */
export const DEMO_BBOX: BBox = [60.138, 24.9, 60.192, 25.0];
/** Safety cap for live graph downloads (longer trips are routed with Valhalla). */
export const MAX_DISTANCE_M = 2500;

export type LoadStage = "fetch" | "build" | "route";

export class LoadError extends Error {}

const graphCache = new Map<string, Promise<Graph>>();

/** True when both points fall inside the bundled central-Helsinki data. */
export function coversDemo(a: LngLat, b: LngLat) {
  return inside(DEMO_BBOX, a) && inside(DEMO_BBOX, b);
}

function inside(b: BBox, p: LngLat, marginDeg = 0.002) {
  return (
    p[1] > b[0] + marginDeg && p[1] < b[2] - marginDeg && p[0] > b[1] + marginDeg && p[0] < b[3] - marginDeg
  );
}

function areaFor(a: LngLat, b: LngLat): BBox {
  const d = haversine(a, b);
  const padM = Math.max(450, d * 0.35);
  const padLat = padM / 110574;
  const padLng = padM / (111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180));
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return [
    r(Math.min(a[1], b[1]) - padLat),
    r(Math.min(a[0], b[0]) - padLng),
    r(Math.max(a[1], b[1]) + padLat),
    r(Math.max(a[0], b[0]) + padLng),
  ];
}

async function fetchOverpass(bbox: BBox, signal?: AbortSignal): Promise<OsmResponse> {
  try {
    const json = (await overpass(buildQuery(bbox, 10), signal, 9000)) as OsmResponse;
    if (!json.elements.length) throw new OverpassError("tyhjä vastaus");
    return json;
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new LoadError(
      "OpenStreetMap-palvelimet ovat juuri nyt ruuhkaisia. Odota hetki ja yritä uudelleen – tai kokeile Helsingin keskustan esimerkkiretkiä, jotka toimivat aina.",
    );
  }
}

/** Returns a routable graph covering both points — bundled data when possible, live Overpass otherwise. */
export async function loadGraph(
  a: LngLat,
  b: LngLat,
  onStage?: (s: LoadStage) => void,
  signal?: AbortSignal,
): Promise<Graph> {
  const d = haversine(a, b);
  const demo = inside(DEMO_BBOX, a) && inside(DEMO_BBOX, b);
  if (d > (demo ? 6000 : MAX_DISTANCE_M))
    throw new LoadError(
      `Matkaa on ${(d / 1000).toFixed(1)} km linnuntietä. Harharetki toimii parhaiten kävelymatkoilla – valitse pisteet alle ${MAX_DISTANCE_M / 1000} km:n päästä toisistaan.`,
    );

  const bbox = demo ? DEMO_BBOX : areaFor(a, b);
  const key = bbox.join(",");
  let p = graphCache.get(key);
  if (!p) {
    // The download is shared and cached, so it must not die with the first caller's signal:
    // a quick re-plan (drag, "Muuta retkeä") would otherwise inherit an aborted promise.
    p = (async () => {
      onStage?.("fetch");
      let data: OsmResponse;
      if (demo) {
        const res = await fetch("/data/helsinki.json");
        if (!res.ok) throw new LoadError("Esimerkkiaineiston lataus epäonnistui. Lataa sivu uudelleen.");
        data = await res.json();
      } else {
        data = await fetchOverpass(bbox);
      }
      onStage?.("build");
      // Let the loading state paint before the CPU-heavy part.
      await new Promise((r) => setTimeout(r, 30));
      return buildGraph(data);
    })();
    graphCache.set(key, p);
    p.catch(() => graphCache.delete(key));
  }
  if (!signal) return p;
  // Each caller can still give up on waiting without cancelling the shared download.
  return new Promise<Graph>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Start downloading and indexing the bundled Helsinki data in the background, so the first
 * trip is instant. Safe to call many times.
 */
export function warmDemoData() {
  if (typeof window === "undefined") return;
  const [s, w, n, e] = DEMO_BBOX;
  const a: LngLat = [w + (e - w) * 0.4, s + (n - s) * 0.5];
  const b: LngLat = [w + (e - w) * 0.6, s + (n - s) * 0.5];
  const idle = (cb: () => void) =>
    "requestIdleCallback" in window ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500);
  idle(() => {
    loadGraph(a, b).catch(() => {
      // A real trip will retry and show the error properly.
    });
  });
}
