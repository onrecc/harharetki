"use client";

import { Marker, type PositionAnchor } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LngLat } from "@/lib/map/types";
import { useMap } from "./MapContext";

type Options = {
  /** Builds the marker's DOM element; called once per mount. */
  createElement: () => HTMLElement;
  anchor?: PositionAnchor;
  draggable?: boolean;
  onDragEnd?: (p: LngLat) => void;
  onClick?: () => void;
};

/** Keeps one MapLibre marker at `lngLat` (removed while null). Returns refs to the marker and its element. */
export function useMarker(lngLat: LngLat | null, opts: Options) {
  const map = useMap();
  const markerRef = useRef<Marker | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const visible = lngLat !== null;
  useEffect(() => {
    if (!map || !visible) return;
    const el = optsRef.current.createElement();
    elRef.current = el;
    const onClick = (e: MouseEvent) => {
      if (!optsRef.current.onClick) return;
      e.stopPropagation();
      optsRef.current.onClick();
    };
    el.addEventListener("click", onClick);
    const marker = new Marker({
      element: el,
      anchor: opts.anchor ?? "center",
      draggable: opts.draggable ?? false,
    });
    marker.on("dragend", () => {
      const p = marker.getLngLat();
      optsRef.current.onDragEnd?.([p.lng, p.lat]);
    });
    markerRef.current = marker;
    return () => {
      el.removeEventListener("click", onClick);
      marker.remove();
      markerRef.current = null;
      elRef.current = null;
    };
    // Anchor/draggable are fixed per component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visible]);

  const lng = lngLat?.[0];
  const lat = lngLat?.[1];
  useEffect(() => {
    const marker = markerRef.current;
    if (!map || !marker || lng === undefined || lat === undefined) return;
    marker.setLngLat([lng, lat]);
    if (!marker.getElement().isConnected) marker.addTo(map);
  }, [map, visible, lng, lat]);

  return { elRef, markerRef };
}
