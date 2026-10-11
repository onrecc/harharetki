export type LngLat = [number, number];
export type RouteId = "fast" | "scenic" | "surprise" | "maze" | "historic";

export interface RouteViz {
  id: RouteId;
  color: string;
  coords: LngLat[];
}

export interface PoiViz {
  id: string;
  lngLat: LngLat;
  label: string;
  /** Finnish category, e.g. "Patsas". */
  kind: string;
  /** 1..n along the route. */
  order: number;
}

export type MapPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Fixed padding, or a function evaluated each time the camera is framed. */
export type PaddingProp = MapPadding | (() => MapPadding);

export const ROUTE_COLORS: Record<RouteId, string> = {
  fast: "#8a8f96",
  scenic: "#1f9d6b",
  surprise: "#e07a2e",
  maze: "#7b4fd6",
  historic: "#c9971c",
};
