"use client";

import { useEffect, useRef } from "react";
import {
  distanceM,
  measure,
  pointAt,
  prefersReducedMotion,
  resolvePadding,
} from "@/lib/map/geo";
import type { LngLat, PaddingProp, PoiViz } from "@/lib/map/types";
import { centerOn } from "@/lib/map/camera";
import { useMap } from "./MapContext";
import { useMarker } from "./useMarker";

type Props = {
  coords: LngLat[] | null;
  playing: boolean;
  /** Metres per real second. */
  speed?: number;
  pois?: PoiViz[];
  onPoiReached?: (id: string) => void;
  onDone?: () => void;
  /** Keeps the walker centred in the visible area (outside the planner UI). */
  padding?: PaddingProp;
  /** Travel by car: the explorer drives a little car instead of walking. */
  car?: boolean;
  /** Level-11 mode: the explorer wobbles like it has had too much coffee. */
  crazy?: boolean;
  /**
   * Live GPS mode: when defined, the walker shows the user's real position (null = no fix yet)
   * instead of animating along the route, and the camera follows gently.
   */
  livePosition?: LngLat | null;
  /** Live mode heading-up: map bearing in degrees (null = north up, flat). */
  liveBearing?: number | null;
};

const REACH_M = 30;
const FOLLOW_PAUSE_MS = 4000;
/** Street-level zoom while following the demo walker. */
const DEMO_FOLLOW_ZOOM = 15.5;
/** The demo walker stops at each sight for this long. */
const STOP_PAUSE_MS = 3000;
const REDUCED_STEP_MS = 1800;

function walkerElement() {
  const el = document.createElement("div");
  el.className = "hr-walker";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Tutkimusmatkailija");
  el.innerHTML = `
    <div class="hr-walker-body" aria-hidden="true">
      <svg width="40" height="48" viewBox="0 0 40 48">
        <defs>
          <linearGradient id="hr-rainbow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#e0573e"/><stop offset=".35" stop-color="#f0a03a"/>
            <stop offset=".65" stop-color="#7b4fd6"/><stop offset="1" stop-color="#d14fa0"/>
          </linearGradient>
        </defs>
        <ellipse cx="20" cy="45" rx="10" ry="2.5" fill="rgba(18,52,77,.25)"/>
        <path class="hr-crazy-only hr-cape" d="M15 18c-5 3-9 9-10 15l6-2 3 3z" fill="url(#hr-rainbow)"/>
        <rect x="8" y="20" width="9" height="14" rx="3" fill="#b5652b"/>
        <path d="M13 24c0-5 3-8 7-8s7 3 7 8v9a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3z" fill="#2c5a6e"/>
        <path class="hr-walker-leg hr-walker-leg--l" d="M17 35v7" stroke="#12344d" stroke-width="3.2" stroke-linecap="round"/>
        <path class="hr-walker-leg hr-walker-leg--r" d="M23 35v7" stroke="#12344d" stroke-width="3.2" stroke-linecap="round"/>
        <circle cx="20" cy="11.5" r="6" fill="#f3c9a0"/>
        <circle class="hr-eye-normal" cx="22.4" cy="11" r="0.9" fill="#12344d"/>
        <g class="hr-crazy-only">
          <circle cx="18.4" cy="11" r="1.6" fill="#fff" stroke="#12344d" stroke-width=".9"/>
          <circle cx="22.8" cy="11" r="1.6" fill="#fff" stroke="#12344d" stroke-width=".9"/>
          <circle cx="18.9" cy="11.4" r=".65" fill="#12344d"/>
          <circle cx="22.3" cy="10.5" r=".65" fill="#12344d"/>
          <path d="M17.4 14.2q2.8 2.4 5.8 0" stroke="#12344d" stroke-width=".9" fill="#fff" stroke-linecap="round"/>
        </g>
        <path d="M11 9.5h18" stroke="#8a5a2b" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M14 9.5c0-4 2.7-6.5 6-6.5s6 2.5 6 6.5z" fill="#c98a3d"/>
        <path d="M14.5 7.5h11" stroke="#8a5a2b" stroke-width="1.4"/>
        <g class="hr-crazy-only">
          <path d="M20 3.2V1.6" stroke="#12344d" stroke-width=".9"/>
          <ellipse class="hr-propeller" cx="20" cy="1.5" rx="5.5" ry="1.1" fill="#e0573e"/>
          <circle cx="20" cy="1.5" r="1" fill="#f2b84b"/>
        </g>
      </svg>
      <svg class="hr-car" width="50" height="30" viewBox="0 0 50 30">
        <ellipse cx="25" cy="27.5" rx="20" ry="2.2" fill="rgba(18,52,77,.25)"/>
        <path d="M5 21v-5c0-1.5 1-2.5 2.5-2.8l5-1 4.5-6c.7-1 1.8-1.5 3-1.5h10c1.2 0 2.3.5 3 1.4l5 6 5.5 1.3c1.4.3 2.5 1.5 2.5 3V21z" fill="#e0573e" stroke="#7a2a1c" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M19 6.6h5.5v5.6h-9.2zM27 6.6h4.4c.6 0 1.1.3 1.5.7l3.9 4.9H27z" fill="#cfe6ee"/>
        <circle cx="21.5" cy="9.3" r="2" fill="#f3c9a0"/>
        <path d="M19.2 8h4.6" stroke="#8a5a2b" stroke-width="1.4" stroke-linecap="round"/>
        <circle class="hr-car-wheel" cx="13" cy="21.5" r="4" fill="#1b2a33" stroke="#fff" stroke-width="1.4" stroke-dasharray="2 2"/>
        <circle class="hr-car-wheel" cx="37" cy="21.5" r="4" fill="#1b2a33" stroke="#fff" stroke-width="1.4" stroke-dasharray="2 2"/>
        <path d="M44.5 15.5h2" stroke="#f2b84b" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <svg class="hr-boat" width="52" height="22" viewBox="0 0 52 22">
        <path class="hr-boat-wake" d="M2 17c4-3 7 3 11 0s7 3 11 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <path d="M6 9h40l-6 10H12z" fill="#b5652b" stroke="#7a3f17" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M9 12h34" stroke="#f2b84b" stroke-width="2"/>
      </svg>
    </div>`;
  return el;
}

export function Walker({
  coords,
  playing,
  speed = 120,
  pois = [],
  onPoiReached,
  onDone,
  padding,
  crazy = false,
  car = false,
  livePosition,
  liveBearing = null,
}: Props) {
  const map = useMap();
  const isLive = livePosition !== undefined;
  const start = isLive ? (livePosition ?? (coords?.[0] ?? null)) : coords && coords.length ? coords[0] : null;
  const { markerRef } = useMarker(start, { createElement: walkerElement, anchor: "bottom" });
  /** The follow loop holds off while the start-of-walk camera move is running. */
  const followHoldUntil = useRef(0);

  useEffect(() => {
    markerRef.current?.getElement().classList.toggle("hr-walker--crazy", crazy);
    markerRef.current?.getElement().classList.toggle("hr-walker--car", car);
  });

  // Latest props for the animation loop without restarting it.
  const live = useRef({ playing, speed, pois, onPoiReached, onDone, padding });
  useEffect(() => {
    live.current = { playing, speed, pois, onPoiReached, onDone, padding };
  });

  // Walk state survives play/pause, resets when the route changes.
  const state = useRef({ d: 0, reached: new Set<string>(), done: false, pauseUntil: 0 });

  useEffect(() => {
    if (!map || !coords || coords.length < 2 || isLive) return;
    const line = measure(coords);
    state.current = { d: 0, reached: new Set(), done: false, pauseUntil: 0 };
    let followPausedUntil = 0;
    const pauseFollow = () => (followPausedUntil = performance.now() + FOLLOW_PAUSE_MS);
    map.on("dragstart", pauseFollow);
    map.on("wheel", pauseFollow);
    map.on("touchstart", pauseFollow);

    const place = (p: LngLat, prev: LngLat | null) => {
      const marker = markerRef.current;
      if (!marker) return;
      marker.setLngLat(p);
      const el = marker.getElement();
      if (prev) {
        const dx = p[0] - prev[0];
        if (Math.abs(dx) > 1e-9) el.classList.toggle("hr-walker--left", dx < 0);
      }
    };

    const follow = (p: LngLat, k: number) => {
      if (performance.now() < followPausedUntil || performance.now() < followHoldUntil.current) return;
      const pad = resolvePadding(live.current.padding);
      const canvas = map.getContainer();
      const cx = (canvas.clientWidth + pad.left - pad.right) / 2;
      const cy = (canvas.clientHeight + pad.top - pad.bottom) / 2;
      const s = map.project(p);
      const dx = s.x - cx;
      const dy = s.y - cy;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      map.panBy([dx * k, dy * k], { duration: 0 });
    };

    // Distance along the route where each POI is closest; POIs may sit off the line.
    const poiAt = new Map<string, number>();
    const alongFor = (poi: PoiViz) => {
      let at = poiAt.get(poi.id);
      if (at === undefined) {
        let best = Infinity;
        at = 0;
        for (let i = 0; i < coords.length; i++) {
          const dist = distanceM(coords[i], poi.lngLat);
          if (dist < best) {
            best = dist;
            at = line.cum[i];
          }
        }
        poiAt.set(poi.id, at);
      }
      return at;
    };

    const checkPois = (p: LngLat) => {
      for (const poi of live.current.pois) {
        if (state.current.reached.has(poi.id)) continue;
        if (distanceM(p, poi.lngLat) <= REACH_M || state.current.d >= alongFor(poi) - REACH_M) {
          state.current.reached.add(poi.id);
          // Linger at the sight for a moment before walking on.
          state.current.pauseUntil = performance.now() + STOP_PAUSE_MS;
          live.current.onPoiReached?.(poi.id);
        }
      }
    };

    const finish = () => {
      if (state.current.done) return;
      state.current.done = true;
      live.current.onDone?.();
    };

    // No ferry flag in the route data: detect water from the rendered map instead.
    // On water with no road/path drawn under the walker (bridges count as land) → boat.
    let lastWaterCheck = 0;
    let waterVotes = 0;
    const checkWater = (p: LngLat, now: number) => {
      if (now - lastWaterCheck < 150 || !map.getLayer("water")) return;
      lastWaterCheck = now;
      const pt = map.project(p);
      const hits = map.queryRenderedFeatures([pt.x, pt.y]);
      const water = hits.some((f) => f.layer.id === "water");
      const road = hits.some((f) => f.sourceLayer === "transportation");
      waterVotes = water && !road ? Math.min(2, waterVotes + 1) : Math.max(0, waterVotes - 1);
      const el = markerRef.current?.getElement();
      if (waterVotes === 2) el?.classList.add("hr-walker--boat");
      else if (waterVotes === 0) el?.classList.remove("hr-walker--boat");
    };

    let raf = 0;
    let timer = 0;
    let last = performance.now();
    let prev: LngLat | null = null;

    if (prefersReducedMotion()) {
      // Jump stop to stop: each POI (in route order), then the destination.
      const stops = () => [
        ...[...live.current.pois].sort((a, b) => a.order - b.order).map((p) => p.lngLat),
        coords[coords.length - 1],
      ];
      let i = 0;
      const step = () => {
        if (live.current.playing && !state.current.done) {
          const s = stops();
          const p = s[Math.min(i, s.length - 1)];
          place(p, prev);
          prev = p;
          map.jumpTo({ center: p });
          checkPois(p);
          i++;
          if (i >= s.length) finish();
        }
        timer = window.setTimeout(step, REDUCED_STEP_MS);
      };
      timer = window.setTimeout(step, 300);
    } else {
      const frame = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const el = markerRef.current?.getElement();
        const { playing: on, speed: v } = live.current;
        const resting = now < state.current.pauseUntil;
        el?.classList.toggle("hr-walker--walking", on && !state.current.done && !resting);
        if (on && !state.current.done) {
          if (!resting) state.current.d = Math.min(line.length, state.current.d + v * dt);
          const p = pointAt(line, state.current.d);
          place(p, prev);
          prev = p;
          follow(p, 0.15);
          checkWater(p, now);
          checkPois(p);
          if (state.current.d >= line.length) finish();
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      map.off("dragstart", pauseFollow);
      map.off("wheel", pauseFollow);
      map.off("touchstart", pauseFollow);
    };
  }, [map, coords, markerRef, isLive]);

  // Demo mode: when the walk starts, fly to the walker itself at street level (centred in the area
  // the planner sheet leaves free); the follow loop waits for that, then keeps it centred.
  useEffect(() => {
    if (!map || isLive || !playing) return;
    const at = markerRef.current?.getLngLat();
    const p: LngLat | null = at ? [at.lng, at.lat] : (coords?.[0] ?? null);
    if (!p) return;
    const duration = prefersReducedMotion() ? 0 : 900;
    followHoldUntil.current = performance.now() + duration + 50;
    centerOn(map, p, resolvePadding(padding), { zoom: DEMO_FOLLOW_ZOOM, duration });
    // Only on start/resume; coords/padding are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLive, playing]);

  // Live mode: like a navigation app, the camera stays locked on the walker at street level.
  const lng = livePosition?.[0];
  const lat = livePosition?.[1];
  useEffect(() => {
    markerRef.current?.getElement().classList.toggle("hr-walker--walking", isLive && playing && lng !== undefined);
    if (!map || !isLive || !playing || lng === undefined || lat === undefined) return;
    centerOn(map, [lng, lat], resolvePadding(padding), {
      zoom: DEMO_FOLLOW_ZOOM,
      duration: prefersReducedMotion() ? 0 : liveBearing !== null ? 300 : 900,
      ...(liveBearing !== null ? { bearing: liveBearing, pitch: 0 } : { bearing: 0, pitch: 0 }),
    });
    // padding is read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLive, playing, lng, lat, markerRef, liveBearing]);

  return null;
}
