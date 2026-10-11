"use client";

import { useEffect, useRef, useState } from "react";
import {
  balticStyle,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  RASTER_STYLE,
  VECTOR_STYLE_URL,
} from "@/lib/map/config";
import { useSetMap } from "./MapContext";
import "./map-visuals.css";

/** Finnish labels for MapLibre's built-in controls. */
const FI_LOCALE = {
  "AttributionControl.ToggleAttribution": "Näytä tai piilota tekijätiedot",
  "AttributionControl.MapFeedback": "Palaute kartasta",
  "GeolocateControl.FindMyLocation": "Etsi sijaintini",
  "GeolocateControl.LocationNotAvailable": "Sijainti ei ole saatavilla",
  "NavigationControl.ResetBearing": "Palauta pohjoinen ylös",
  "NavigationControl.ZoomIn": "Lähennä",
  "NavigationControl.ZoomOut": "Loitonna",
  "ScaleControl.Feet": "ft",
  "ScaleControl.Meters": "m",
  "ScaleControl.Kilometers": "km",
  "ScaleControl.Miles": "mi",
  "ScaleControl.NauticalMiles": "mpk",
  "CooperativeGesturesHandler.WindowsHelpText": "Zoomaa karttaa Ctrl + vierityksellä",
  "CooperativeGesturesHandler.MacHelpText": "Zoomaa karttaa ⌘ + vierityksellä",
  "CooperativeGesturesHandler.MobileHelpText": "Liikuta karttaa kahdella sormella",
};

type Props = {
  className?: string;
  center?: [number, number];
  zoom?: number;
};

export function MapView({
  className = "absolute inset-0",
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setMap = useSetMap();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;

    (async () => {
      // maplibre touches window/WebGL, so load it client-side only.
      const [maplibregl, style] = await Promise.all([
        import("maplibre-gl"),
        fetch(VECTOR_STYLE_URL)
          .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
          .then(balticStyle)
          .catch((err) => {
            console.warn("Vector style unavailable, using OSM raster", err);
            return RASTER_STYLE;
          }),
      ]);
      if (cancelled || !containerRef.current) return;

      // Turbopack doesn't emit maplibre's module worker; serve it from public/ (copied by `predev`/`prebuild`).
      maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
      const m = new maplibregl.Map({
        container: containerRef.current,
        style,
        center,
        zoom,
        attributionControl: { compact: false },
        locale: FI_LOCALE,
      });

      map = m;
      m.addControl(new maplibregl.NavigationControl(), "bottom-right");
      m.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
        }),
        "bottom-right",
      );
      m.addControl(new maplibregl.ScaleControl(), "bottom-right");

      m.once("load", () => {
        if (cancelled) return;
        setStatus("ready");
        setMap(m);
      });
    })().catch((err) => {
      console.error("Map init failed", err);
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      setMap(null);
      map?.remove();
    };
    // Init once; center/zoom are initial values only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <div ref={containerRef} className="h-full w-full" />
      {status !== "ready" && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100 text-sm text-slate-600"
        >
          {status === "loading"
            ? "Ladataan karttaa…"
            : "Karttaa ei voitu ladata. Tarkista verkkoyhteys."}
        </div>
      )}
    </div>
  );
}
