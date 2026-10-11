"use client";

import type { MapMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LngLat } from "@/lib/map/types";
import { useMap } from "./MapContext";
import { ROUTE_HIT_LAYER } from "./RouteLayers";

/** Plain map clicks only: skips clicks on routes and on any marker (endpoints, POIs, walker). */
export function MapClick({ onClick }: { onClick: (p: LngLat) => void }) {
  const map = useMap();
  const cbRef = useRef(onClick);
  useEffect(() => {
    cbRef.current = onClick;
  });

  useEffect(() => {
    if (!map) return;
    const handler = (e: MapMouseEvent) => {
      const target = e.originalEvent.target as Element | null;
      if (target?.closest?.(".maplibregl-marker")) return;
      if (
        map.getLayer(ROUTE_HIT_LAYER) &&
        map.queryRenderedFeatures(e.point, { layers: [ROUTE_HIT_LAYER] }).length
      ) {
        return;
      }
      cbRef.current([e.lngLat.lng, e.lngLat.lat]);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map]);

  return null;
}
