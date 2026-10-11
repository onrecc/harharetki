"use client";

import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";
import { useEffect, useRef } from "react";
import {
  boundsOf,
  measure,
  pointAt,
  prefersReducedMotion,
  resolvePadding,
  sliceTo,
} from "@/lib/map/geo";
import { frameBounds } from "@/lib/map/camera";
import type { LngLat, PaddingProp, RouteId, RouteViz } from "@/lib/map/types";
import { useMap } from "./MapContext";

/** Invisible wide line used for click/hover hit-testing; MapClick skips features on it. */
export const ROUTE_HIT_LAYER = "hr-route-hit";

const SRC = "hr-routes";
const HEADS = "hr-route-heads";
const RACE_MS = 2500;

type Props = {
  routes: RouteViz[];
  selectedId: RouteId | null;
  onSelect?: (id: RouteId) => void;
  /** fitBounds padding; defaults to clearing the planner sidebar / bottom sheet. */
  padding?: PaddingProp;
  /** Fade unselected routes while one is selected (default true). */
  dimOthers?: boolean;
  /** Level-11 mode: paint the selected route as a rainbow. */
  crazy?: boolean;
};

const NOT_FAST = ["!=", ["get", "id"], "fast"] as const;

/** Blend `hex` toward the map's sand colour; an opaque tint can't stack up where the line overlaps itself. */
function tint(hex: string, amount: number): string {
  const n = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const c = hex.replace("#", "");
  const sand = "f6f2ea";
  const mix = (i: number) => Math.round(n(c, i) * amount + n(sand, i) * (1 - amount));
  return `rgb(${mix(0)}, ${mix(2)}, ${mix(4)})`;
}

type Feature = {
  type: "Feature";
  properties: { id: RouteId; color: string; halo: string };
  geometry: { type: "LineString"; coordinates: LngLat[] };
};

function lines(routes: RouteViz[], coordsOf: (r: RouteViz, i: number) => LngLat[]) {
  return {
    type: "FeatureCollection" as const,
    features: routes.map(
      (r, i): Feature => ({
        type: "Feature",
        properties: { id: r.id, color: r.color, halo: tint(r.color, 0.38) },
        geometry: { type: "LineString", coordinates: coordsOf(r, i) },
      }),
    ),
  };
}

const RAINBOW = ["#e0573e", "#f0a03a", "#e8c63a", "#1f9d6b", "#2c6e85", "#7b4fd6", "#d14fa0"];

function mixHex(a: string, b: string, t: number): string {
  const n = (h: string, i: number) => parseInt(h.slice(1 + i, 3 + i), 16);
  const c = (i: number) => Math.round(n(a, i) + (n(b, i) - n(a, i)) * t);
  return `rgb(${c(0)}, ${c(2)}, ${c(4)})`;
}

/** line-gradient with the rainbow shifted by `phase` (0..1); the bands repeat twice along the route. */
function rainbowGradient(phase: number) {
  const steps = 28;
  const stops: (number | string)[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    const u = (((x * 2 - phase) % 1) + 1) % 1; // 0..1 around the palette
    const f = u * RAINBOW.length;
    const k = Math.floor(f) % RAINBOW.length;
    stops.push(x, mixHex(RAINBOW[k], RAINBOW[(k + 1) % RAINBOW.length], f - Math.floor(f)));
  }
  return ["interpolate", ["linear"], ["line-progress"], ...stops];
}

function addLayers(map: MapLibreMap) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource(SRC, { type: "geojson", data: empty, lineMetrics: true });
  map.addSource(HEADS, { type: "geojson", data: empty });

  const round = { "line-cap": "round", "line-join": "round" } as const;
  // Baseline "fast" route: thin, grey, dashed.
  map.addLayer({
    id: "hr-route-fast",
    type: "line",
    source: SRC,
    filter: ["==", ["get", "id"], "fast"],
    layout: { "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 3, "line-dasharray": [2, 1.5] },
  });
  // Soft halo: opaque pre-blended tint (translucent blur stacked into bright blobs at turns).
  map.addLayer({
    id: "hr-route-glow",
    type: "line",
    source: SRC,
    filter: NOT_FAST as never,
    layout: round,
    paint: { "line-color": ["get", "halo"], "line-width": 16, "line-blur": 2 },
  });
  map.addLayer({
    id: "hr-route-casing",
    type: "line",
    source: SRC,
    filter: NOT_FAST as never,
    layout: round,
    paint: { "line-color": "#ffffff", "line-width": 9 },
  });
  map.addLayer({
    id: "hr-route-line",
    type: "line",
    source: SRC,
    filter: NOT_FAST as never,
    layout: round,
    paint: { "line-color": ["get", "color"], "line-width": 5 },
  });
  // Selected route, drawn again on top of the others.
  map.addLayer({
    id: "hr-sel-glow",
    type: "line",
    source: SRC,
    filter: ["==", ["get", "id"], ""],
    layout: round,
    paint: { "line-color": ["get", "halo"], "line-width": 20, "line-blur": 2.5 },
  });
  map.addLayer({
    id: "hr-sel-casing",
    type: "line",
    source: SRC,
    filter: ["==", ["get", "id"], ""],
    layout: round,
    paint: { "line-color": "#ffffff", "line-width": 11 },
  });
  map.addLayer({
    id: "hr-sel-line",
    type: "line",
    source: SRC,
    filter: ["==", ["get", "id"], ""],
    layout: round,
    paint: { "line-color": ["get", "color"], "line-width": 7 },
  });
  map.addLayer({
    id: "hr-sel-rainbow",
    type: "line",
    source: SRC,
    filter: ["==", ["get", "id"], ""],
    layout: { ...round, visibility: "none" },
    paint: {
      "line-width": 6,
      "line-gradient": rainbowGradient(0) as never,
    },
  });
  map.addLayer({
    id: ROUTE_HIT_LAYER,
    type: "line",
    source: SRC,
    layout: round,
    paint: { "line-color": "#000000", "line-width": 22, "line-opacity": 0 },
  });
  // Glowing race heads.
  map.addLayer({
    id: "hr-head-glow",
    type: "circle",
    source: HEADS,
    paint: { "circle-color": ["get", "color"], "circle-radius": 16, "circle-blur": 1, "circle-opacity": 0.6 },
  });
  map.addLayer({
    id: "hr-head",
    type: "circle",
    source: HEADS,
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
}

const LAYERS = [
  "hr-route-fast",
  "hr-route-glow",
  "hr-route-casing",
  "hr-route-line",
  "hr-sel-glow",
  "hr-sel-casing",
  "hr-sel-line",
  "hr-sel-rainbow",
  ROUTE_HIT_LAYER,
  "hr-head-glow",
  "hr-head",
];

function removeLayers(map: MapLibreMap) {
  try {
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC, HEADS]) if (map.getSource(id)) map.removeSource(id);
  } catch {
    // Map already destroyed.
  }
}

export function RouteLayers({ routes, selectedId, onSelect, padding, dimOthers = true, crazy = false }: Props) {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  const paddingRef = useRef(padding);
  useEffect(() => {
    onSelectRef.current = onSelect;
    paddingRef.current = padding;
  });

  // Layers + interaction, once per map.
  useEffect(() => {
    if (!map) return;
    addLayers(map);
    const click = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as RouteId | undefined;
      if (id) onSelectRef.current?.(id);
    };
    const enter = () => (map.getCanvas().style.cursor = "pointer");
    const leave = () => (map.getCanvas().style.cursor = "");
    map.on("click", ROUTE_HIT_LAYER, click);
    map.on("mouseenter", ROUTE_HIT_LAYER, enter);
    map.on("mouseleave", ROUTE_HIT_LAYER, leave);
    return () => {
      map.off("click", ROUTE_HIT_LAYER, click);
      map.off("mouseenter", ROUTE_HIT_LAYER, enter);
      map.off("mouseleave", ROUTE_HIT_LAYER, leave);
      leave();
      removeLayers(map);
    };
  }, [map]);

  // Race: every route grows from the start at the same speed, so the shortest finishes first.
  useEffect(() => {
    if (!map) return;
    const src = map.getSource<GeoJSONSource>(SRC);
    const heads = map.getSource<GeoJSONSource>(HEADS);
    if (!src || !heads) return;

    const bounds = boundsOf(routes.map((r) => r.coords));
    if (bounds) {
      frameBounds(map, bounds as LngLatBoundsLike, resolvePadding(paddingRef.current), {
        maxZoom: 17,
        duration: prefersReducedMotion() ? 0 : 900,
      });
    }

    const measured = routes.map((r) => measure(r.coords));
    const longest = Math.max(0, ...measured.map((m) => m.length));
    const emptyHeads = { type: "FeatureCollection" as const, features: [] };

    if (prefersReducedMotion() || longest === 0) {
      src.setData(lines(routes, (r) => r.coords));
      heads.setData(emptyHeads);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / RACE_MS);
      const d = longest * (1 - (1 - p) ** 2); // ease-out
      src.setData(lines(routes, (_, i) => sliceTo(measured[i], d)));
      heads.setData({
        type: "FeatureCollection",
        features: routes.flatMap((r, i) =>
          d < measured[i].length
            ? [
                {
                  type: "Feature" as const,
                  properties: { color: r.color },
                  geometry: { type: "Point" as const, coordinates: pointAt(measured[i], d) },
                },
              ]
            : [],
        ),
      });
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [map, routes]);

  // Selection: lift the selected route, dim the rest.
  useEffect(() => {
    if (!map || !map.getLayer("hr-sel-line")) return;
    const sel = selectedId ?? "";
    const isSel = ["==", ["get", "id"], sel];
    const notSel = ["!=", ["get", "id"], sel];
    map.setFilter("hr-route-fast", ["all", ["==", ["get", "id"], "fast"], notSel] as never);
    for (const id of ["hr-route-casing", "hr-route-glow", "hr-route-line"]) {
      map.setFilter(id, ["all", NOT_FAST, notSel] as never);
    }
    for (const id of ["hr-sel-casing", "hr-sel-glow", "hr-sel-line", "hr-sel-rainbow"]) {
      map.setFilter(id, isSel as never);
    }
    const dim = selectedId && dimOthers ? 0.25 : 1;
    map.setPaintProperty("hr-route-fast", "line-opacity", dim);
    map.setPaintProperty("hr-route-casing", "line-opacity", dim);
    map.setPaintProperty("hr-route-glow", "line-opacity", dim);
    map.setPaintProperty("hr-route-line", "line-opacity", dim);
    map.setLayoutProperty("hr-sel-rainbow", "visibility", crazy ? "visible" : "none");
  }, [map, selectedId, dimOthers, crazy]);

  // Level 11: the rainbow flows along the route from start to end.
  useEffect(() => {
    if (!map || !crazy || prefersReducedMotion()) return;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 33) return; // ~30 fps is plenty for a gradient
      last = now;
      if (!map.getLayer("hr-sel-rainbow")) return;
      map.setPaintProperty("hr-sel-rainbow", "line-gradient", rainbowGradient(((now - t0) / 4000) % 1) as never);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, crazy]);

  return null;
}
