"use client";

import { useEffect } from "react";
import type { PoiViz } from "@/lib/map/types";
import { useMarker } from "./useMarker";

type Props = {
  pois: PoiViz[];
  activeId: string | null;
  onClick?: (id: string) => void;
};

function PoiMarker({
  poi,
  active,
  onClick,
}: {
  poi: PoiViz;
  active: boolean;
  onClick?: (id: string) => void;
}) {
  const { elRef } = useMarker(poi.lngLat, {
    createElement: () => {
      // MapLibre positions the root via `transform`; keep transitions on the inner badge only,
      // otherwise the marker trails behind while panning.
      const root = document.createElement("div");
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hr-poi";
      el.textContent = String(poi.order);
      el.setAttribute("aria-label", `${poi.order}. ${poi.label} (${poi.kind})`);
      el.title = `${poi.label} · ${poi.kind}`;
      root.append(el);
      return root;
    },
    onClick: () => onClick?.(poi.id),
  });

  useEffect(() => {
    const el = elRef.current?.firstElementChild;
    if (!el) return;
    el.classList.toggle("hr-poi--active", active);
    if (active) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
  });

  return null;
}

/** Numbered badges along the selected route; the active one pulses. */
export function PoiMarkers({ pois, activeId, onClick }: Props) {
  return (
    <>
      {pois.map((p) => (
        <PoiMarker key={p.id} poi={p} active={p.id === activeId} onClick={onClick} />
      ))}
    </>
  );
}
