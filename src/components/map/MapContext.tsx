"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { createContext, useContext, useState, type ReactNode } from "react";

type MapContextValue = {
  /** The MapLibre instance, or null until the style has loaded. */
  map: MapLibreMap | null;
  setMap: (map: MapLibreMap | null) => void;
};

const MapContext = createContext<MapContextValue | null>(null);

export function MapProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  return <MapContext value={{ map, setMap }}>{children}</MapContext>;
}

/** Returns the loaded MapLibre map (null until ready). Use inside <MapProvider>. */
export function useMap(): MapLibreMap | null {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useMap must be used inside <MapProvider>");
  return ctx.map;
}

export function useSetMap() {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("MapView must be rendered inside <MapProvider>");
  return ctx.setMap;
}
