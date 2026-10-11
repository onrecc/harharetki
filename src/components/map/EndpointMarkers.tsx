"use client";

import type { LngLat } from "@/lib/map/types";
import { useMarker } from "./useMarker";

type Which = "start" | "end";

type Props = {
  start: LngLat | null;
  end: LngLat | null;
  onDragEnd?: (which: Which, p: LngLat) => void;
};

function startElement() {
  const el = document.createElement("div");
  el.className = "hr-endpoint hr-endpoint--start";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Lähtöpiste – vedä siirtääksesi");
  el.innerHTML = `<span class="hr-start-ring" aria-hidden="true"></span><span class="hr-endpoint-label" aria-hidden="true">Lähtö</span>`;
  return el;
}

function endElement() {
  const el = document.createElement("div");
  el.className = "hr-endpoint hr-endpoint--end";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Määränpää – vedä siirtääksesi");
  el.innerHTML = `
    <svg class="hr-end-pin" width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">
      <path d="M17 43C17 43 3 27.5 3 16.5a14 14 0 0 1 28 0C31 27.5 17 43 17 43Z" fill="#12344d" stroke="#fff" stroke-width="2.5"/>
      <path d="M12.5 9.5v14" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      <path d="M13 10h9.5l-2.2 3.2 2.2 3.3H13z" fill="#f2b84b"/>
    </svg>
    <span class="hr-endpoint-label" aria-hidden="true">Määränpää</span>`;
  return el;
}

export function EndpointMarkers({ start, end, onDragEnd }: Props) {
  useMarker(start, {
    createElement: startElement,
    draggable: true,
    onDragEnd: (p) => onDragEnd?.("start", p),
  });
  useMarker(end, {
    createElement: endElement,
    anchor: "bottom",
    draggable: true,
    onDragEnd: (p) => onDragEnd?.("end", p),
  });
  return null;
}
