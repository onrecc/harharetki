"use client";

import type { LngLat } from "@/lib/map/types";
import { useMarker } from "./useMarker";

export type PhotoPin = { id: string; lngLat: LngLat; name: string; image?: string };

function Pin({ pin, delayMs }: { pin: PhotoPin; delayMs: number }) {
  useMarker(pin.lngLat, {
    anchor: "bottom",
    createElement: () => {
      const root = document.createElement("div");
      root.className = "hr-photo-pin";
      root.setAttribute("role", "img");
      root.setAttribute("aria-label", pin.name);
      root.innerHTML = `<div class="hr-photo-pin-inner" style="animation-delay:${delayMs}ms">
          <span class="hr-photo-pin-img"></span>
          <span class="hr-photo-pin-name"></span>
        </div>`;
      root.querySelector<HTMLElement>(".hr-photo-pin-name")!.textContent = pin.name;
      const img = root.querySelector<HTMLElement>(".hr-photo-pin-img")!;
      if (pin.image) {
        const el = document.createElement("img");
        el.src = pin.image;
        el.alt = "";
        img.append(el);
      }
      return root;
    },
  });
  return null;
}

/** Decorative photo markers for sights (used on the welcome screen's example trip). */
export function PhotoPins({ pins }: { pins: PhotoPin[] }) {
  return (
    <>
      {pins.map((p, i) => (
        // Re-mount when the image arrives so the marker shows it.
        <Pin key={`${p.id}-${p.image ? 1 : 0}`} pin={p} delayMs={900 + i * 250} />
      ))}
    </>
  );
}
