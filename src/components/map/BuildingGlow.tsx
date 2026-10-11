"use client";

import type {
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "./MapContext";

/**
 * Building polygons along a route. Feature properties: `historic: boolean` (glows stronger)
 * and optional `year: number` (shown as a label).
 */
export type BuildingCollection = Exclude<GeoJSONSourceSpecification["data"], string>;

const SRC = "hr-buildings";
const LAYERS = ["hr-bld-fill", "hr-bld-glow", "hr-bld-year"];
const GOLD = "#c9971c";

/** Fades in with zoom: invisible at z14, faint at z15, clear from ~z16.5. */
const byZoom = (historic: number, other: number): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  0,
  15,
  ["case", ["get", "historic"], historic * 0.35, other * 0.35],
  16.5,
  ["case", ["get", "historic"], historic, other],
];

function addLayers(map: MapLibreMap) {
  map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // Keep buildings under the route lines.
  const before = map.getLayer("hr-route-fast") ? "hr-route-fast" : undefined;
  map.addLayer(
    {
      id: "hr-bld-fill",
      type: "fill",
      source: SRC,
      minzoom: 14,
      paint: { "fill-color": GOLD, "fill-opacity": byZoom(0.45, 0.2) },
    },
    before,
  );
  map.addLayer(
    {
      id: "hr-bld-glow",
      type: "line",
      source: SRC,
      minzoom: 14,
      layout: { "line-join": "round" },
      paint: {
        "line-color": GOLD,
        "line-width": ["case", ["get", "historic"], 7, 4],
        "line-blur": 4,
        "line-opacity": byZoom(0.7, 0.3),
      },
    },
    before,
  );
  map.addLayer({
    id: "hr-bld-year",
    type: "symbol",
    source: SRC,
    minzoom: 16,
    filter: ["has", "year"],
    layout: {
      "text-field": ["to-string", ["get", "year"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#6e5210",
      "text-halo-color": "#f6f2ea",
      "text-halo-width": 1.5,
    },
  });
}

export function BuildingGlow({ data }: { data: BuildingCollection | null }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    addLayers(map);
    return () => {
      try {
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {
        // Map already destroyed.
      }
    };
  }, [map]);

  useEffect(() => {
    map
      ?.getSource<GeoJSONSource>(SRC)
      ?.setData(data ?? { type: "FeatureCollection", features: [] });
  }, [map, data]);

  return null;
}
