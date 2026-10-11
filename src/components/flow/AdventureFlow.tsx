"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PhotoPins,
  BuildingGlow,
  EndpointMarkers,
  MapClick,
  PoiMarkers,
  RouteLayers,
  Walker,
  useMap,
  type BuildingCollection,
} from "@/components/map";
import { PlaceInput } from "@/components/planner/PlaceInput";
import { fetchRouteBuildings } from "@/lib/osm/buildings";
import { decodeTrip, encodeTrip, shareTrip, type TripLink } from "@/lib/share";
import { buildManeuvers, fmtDistance, nextManeuver, routeProgress } from "@/lib/routing/turns";
import { reverseName, type Place } from "@/lib/osm/geocode";
import { boundsOf, defaultPadding, distanceM, prefersReducedMotion } from "@/lib/map/geo";
import { centerOn, frameBounds } from "@/lib/map/camera";
import { DEFAULT_CENTER } from "@/lib/map/config";
import { ROUTE_COLORS, type LngLat, type MapPadding, type RouteViz } from "@/lib/map/types";
import {
  planAdventure,
  type Adventure,
  type AdventureStyle,
  type LoadStage,
  type Midstop,
  type Wander,
  WANDER_LABELS,
} from "@/lib/routing/adventure";
import { useStopImages } from "./stopImages";
import { WanderDial } from "./WanderDial";
import { WelcomeScreen } from "./WelcomeScreen";
import "./flow.css";

type Step = "input" | "launch" | "choose" | "loading" | "result" | "error";
type Endpoint = { lngLat: LngLat; name: string };

const LAUNCH_MS = 1300;
/** How long the preview tour lingers on each stop (the fly-in takes ~1.1 s of it). */
const TOUR_STOP_MS = 5500;
/** How long the card shows a stop the demo walker is passing. */
const PASSING_STOP_MS = 6000;
const MIN_LOADING_MS = 1800;

const STYLES: {
  id: AdventureStyle;
  title: string;
  text: string;
  color: string;
  icon: ReactNode;
}[] = [
  {
    id: "scenic",
    title: "Maisemaseikkailu",
    text: "Puistoja, rantoja ja näköaloja.",
    color: ROUTE_COLORS.scenic,
    icon: (
      <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Zm0 0 7-7" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    id: "historic",
    title: "Historiaseikkailu",
    text: "Muistomerkkejä, linnoja ja tarinoita.",
    color: ROUTE_COLORS.historic,
    icon: (
      <path d="M4 9h16L12 4 4 9Zm2 0v8m4-8v8m4-8v8m4-8v8M3 20h18" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    id: "surprise",
    title: "Yllätysseikkailu",
    text: "Kummallisuuksia, joita et tiennyt olevan.",
    color: ROUTE_COLORS.surprise,
    icon: (
      <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" strokeLinecap="round" />
    ),
  },
];

const CRAZY_STAGE_TEXT: Record<LoadStage, string> = {
  fetch: "Pyöritetään kompassia…",
  build: "Solmitaan katuja rusetille…",
  route: "Etsitään hulluinta mahdollista reittiä…",
};

const STAGE_TEXT: Record<LoadStage, string> = {
  fetch: "Kartoitetaan maastoa…",
  build: "Piirretään polkuja…",
  route: "Etsitään seikkailun reittiä…",
};

/** Inside the bundled central-Helsinki data, so it always works offline from Overpass. */
const EXAMPLE_TRIP: { start: Endpoint; end: Endpoint } = {
  start: { lngLat: [24.9431, 60.1707], name: "Rautatientori" },
  end: { lngLat: [24.9567, 60.1576], name: "Kaivopuisto" },
};

/** Map credits for phones, where MapLibre's own attribution control is hidden (it covered the map). */
function Credits() {
  return (
    <p className="flow-credits">
      Karttadata ©{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        OpenStreetMap-tekijät
      </a>{" "}
      · <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ·{" "}
      <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">
        © OpenMapTiles
      </a>
    </p>
  );
}

/** One line in the live walking bar: thumbnail (or number), label, name and distance. */
function LiveRow({
  label,
  name,
  image,
  num,
  dist,
}: {
  label: string;
  name: string;
  image?: string;
  num: number | string;
  dist: number | null;
}) {
  return (
    <li className="flow-live-row">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="flow-stop-thumb" />
      ) : (
        <span className="flow-stop-thumb flow-stop-thumb--empty" aria-hidden>
          {num}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[var(--ink-soft)]">{label}</span>
        <span className="block truncate font-semibold text-[var(--ink)]">{name}</span>
      </span>
      {dist !== null && <span className="flow-live-dist">{fmtDist(dist)}</span>}
    </li>
  );
}

/** One-shot device position, or null (no permission, insecure origin, timeout). */
function currentPosition(timeoutMs = 4000): Promise<LngLat | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

type Mode = "live" | "demo";
const MODE_KEY = "harharetki:mode";
type Travel = "walk" | "car";
const TRAVEL_KEY = "harharetki:travel";

const fmtDist = (m: number) =>
  m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} km`;

type SheetSize = "peek" | "half" | "full";
/** Smallest sheet: handle + the action buttons + credits. */
const SHEET_PEEK_PX = 168;

/** "38 min" or "7 h 38 min". */
function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Rewrite "403 min" in prose as "6 h 43 min" (stories count detours in minutes). */
const withHours = (text: string) => text.replace(/\b(\d{2,4}) min\b/g, (m, n) => (Number(n) >= 60 ? formatDuration(Number(n)) : m));

const formatKm = (m: number) => `${(m / 1000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} km`;

/** Metres per real second: a short stroll takes ~25 s, long trips are capped at ~45 s on screen. */
const walkSpeed = (distanceM: number) => Math.min(1200, Math.max(70, distanceM / 45));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AdventureFlow() {
  const map = useMap();
  const [step, setStep] = useState<Step>("input");
  const [start, setStart] = useState<Endpoint | null>(null);
  const [end, setEnd] = useState<Endpoint | null>(null);
  const [activeField, setActiveField] = useState<"start" | "end">("start");
  const [style, setStyle] = useState<AdventureStyle | null>(null);
  const [stage, setStage] = useState<LoadStage>("fetch");
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [wander, setWander] = useState<Wander>(2);
  const [reachedIds, setReachedIds] = useState<string[]>([]);
  /** A stop the user picked; null means "follow the next unvisited stop". */
  const [focused, setFocused] = useState<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const [walkKey, setWalkKey] = useState(0);
  /** After the preview tour: zoomed out to the whole route, card shows a summary. */
  const [overview, setOverview] = useState(false);
  /** Phone bottom sheet size; desktop ignores it. */
  // Sheet size is remembered per step only, so e.g. "peek" doesn't squeeze the next step.
  const [sheetState, setSheetState] = useState<{ step: Step; size: SheetSize }>({ step: "input", size: "half" });
  const sheet: SheetSize = sheetState.step === step ? sheetState.size : "half";
  const setSheet = (next: SheetSize | ((s: SheetSize) => SheetSize)) =>
    setSheetState((prev) => {
      const cur = prev.step === step ? prev.size : "half";
      return { step, size: typeof next === "function" ? next(cur) : next };
    });
  const cycleSheet = () => setSheet((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));
  const [dragH, setDragH] = useState<number | null>(null);
  /** Height the sheet animates to after a release, before handing back to CSS (needed for "half", which is auto-height). */
  const [settleH, setSettleH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean; lastY: number; lastT: number; v: number } | null>(
    null,
  );

  const sheetHeights = () => {
    const el = panelRef.current;
    const vh = window.innerHeight;
    // "half" hugs its content, capped like the CSS (60% in the result view, 72% elsewhere).
    const natural = el ? el.scrollHeight : vh * 0.6;
    return {
      peek: SHEET_PEEK_PX,
      half: Math.max(SHEET_PEEK_PX + 40, Math.min(natural, vh * (step === "result" ? 0.6 : 0.72))),
      full: vh * 0.92,
    };
  };
  const onHandleDown = (e: React.PointerEvent) => {
    const h = panelRef.current?.getBoundingClientRect().height ?? 0;
    drag.current = { y: e.clientY, h, moved: false, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    setSettleH(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    // Upward velocity in px/ms, smoothed.
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = 0.6 * ((d.lastY - e.clientY) / dt) + 0.4 * d.v;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    if (d.moved) setDragH(Math.min(sheetHeights().full, Math.max(SHEET_PEEK_PX - 20, d.h + dy)));
  };
  const onHandleUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      // Tap: step through the sizes.
      cycleSheet();
      return;
    }
    const h = d.h + (d.y - e.clientY);
    const sizes = sheetHeights();
    const order: SheetSize[] = ["peek", "half", "full"];
    let target = order.reduce((a, b) => (Math.abs(sizes[b] - h) < Math.abs(sizes[a] - h) ? b : a));
    // A flick moves one size in its direction even if released nearer the old one.
    if (Math.abs(d.v) > 0.45) {
      const from = order.reduce((a, b) => (Math.abs(sizes[b] - d.h) < Math.abs(sizes[a] - d.h) ? b : a));
      const i = order.indexOf(from) + (d.v > 0 ? 1 : -1);
      target = order[Math.max(0, Math.min(order.length - 1, i))];
    }
    setSheet(target);
    setDragH(null);
    // Animate to an explicit pixel height, then let CSS take over (auto heights can't transition).
    setSettleH(sizes[target]);
    window.setTimeout(() => setSettleH(null), 300);
  };
  const [buildings, setBuildings] = useState<BuildingCollection | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  // ---- Live (GPS) vs demo walking -------------------------------------------------------------
  // Full-screen welcome (live vs demo) on every fresh visit; shared trip links skip it.
  const [welcome, setWelcome] = useState(true);
  const [mode, setModeState] = useState<Mode | null>(null);
  const [travel, setTravelState] = useState<Travel>("walk");
  // run() reads this, so it doesn't need another parameter.
  const travelRef = useRef<Travel>("walk");
  useEffect(() => {
    travelRef.current = travel;
  }, [travel]);
  const setTravel = (t: Travel) => {
    setTravelState(t);
    try {
      window.localStorage.setItem(TRAVEL_KEY, t);
    } catch {}
  };
  const car = travel === "car";
  const [modeLoaded, setModeLoaded] = useState(false);
  useEffect(() => {
    // Deferred: localStorage isn't available during SSR, and reading it while rendering would mismatch.
    const id = window.setTimeout(() => {
      let m: string | null = null;
      try {
        m = window.localStorage.getItem(MODE_KEY);
      } catch {}
      const stored = m === "live" || m === "demo" ? m : null;
      // A trip link (shared, or this page reloaded mid-trip) skips the welcome. Only a first-time
      // visitor without a stored choice is put into demo mode.
      const link = decodeTrip(window.location.search);
      setModeState(stored ?? (link ? "demo" : null));
      let tv: string | null = null;
      try {
        tv = window.localStorage.getItem(TRAVEL_KEY);
      } catch {}
      const linkTravel = (link as { travel?: Travel } | null)?.travel;
      const t0: Travel = linkTravel ?? (tv === "car" ? "car" : "walk");
      travelRef.current = t0;
      setTravelState(t0);
      if (link) setWelcome(false);
      setModeLoaded(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  // The map behind the welcome is a backdrop: no panning, zooming or rotating until a mode is chosen.
  useEffect(() => {
    if (!map) return;
    const handlers = [
      map.dragPan,
      map.scrollZoom,
      map.boxZoom,
      map.dragRotate,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];
    for (const h of handlers) {
      if (welcome) h.disable();
      else h.enable();
    }
  }, [map, welcome]);
  // A real example trip drawn on the map behind the welcome screen.
  const [previewAdv, setPreviewAdv] = useState<Adventure | null>(null);
  useEffect(() => {
    if (!welcome || !map || previewAdv) return;
    let alive = true;
    planAdventure(EXAMPLE_TRIP.start.lngLat, EXAMPLE_TRIP.end.lngLat, "historic", undefined, { wander: 3 })
      .then((a) => alive && setPreviewAdv(a))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [welcome, map, previewAdv]);
  const isLive = mode === "live";
  const [livePos, setLivePos] = useState<LngLat | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [farFromStart, setFarFromStart] = useState<number | null>(null);
  const [liveAnnounce, setLiveAnnounce] = useState("");
  const [locating, setLocating] = useState(false);
  const watchId = useRef<number | null>(null);

  // ---- Heading-up map while walking live --------------------------------------------------------
  const [headingUp, setHeadingUp] = useState(true);
  const [liveBearing, setLiveBearing] = useState<number | null>(null);
  const bearingRef = useRef<number | null>(null);
  const gpsHeadingAt = useRef(0);
  /** Smoothly follow a new heading; only re-render on changes > 5°. */
  const pushHeading = (h: number) => {
    const prev = bearingRef.current;
    if (prev === null) {
      bearingRef.current = h;
      setLiveBearing(Math.round(h));
      return;
    }
    const diff = ((h - prev + 540) % 360) - 180;
    const next = (prev + diff * 0.35 + 360) % 360;
    bearingRef.current = next;
    setLiveBearing((cur) => (cur === null || Math.abs((((next - cur + 540) % 360) - 180)) > 5 ? Math.round(next) : cur));
  };
  const onOrientation = useRef((e: DeviceOrientationEvent) => {
    // Prefer GPS course while actually moving; the compass fills in when standing still.
    if (performance.now() - gpsHeadingAt.current < 4000) return;
    const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    const h = typeof ios === "number" ? ios : e.absolute && e.alpha !== null ? (360 - e.alpha) % 360 : null;
    if (h !== null && Number.isFinite(h)) pushHeadingRef.current(h);
  });
  const pushHeadingRef = useRef(pushHeading);
  useEffect(() => {
    pushHeadingRef.current = pushHeading;
  });
  // Latest values for the geolocation callback (which outlives renders).
  const liveCtx = useRef<{ stops: Midstop[]; reached: string[]; adventure: Adventure | null }>({
    stops: [],
    reached: [],
    adventure: null,
  });
  useEffect(() => {
    liveCtx.current = { stops: adventure?.stops ?? [], reached: reachedIds, adventure };
  });

  const stopLive = () => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    window.removeEventListener("deviceorientationabsolute", onOrientation.current as EventListener, true);
    window.removeEventListener("deviceorientation", onOrientation.current as EventListener, true);
  };
  /** Stop live walking completely and clear every live-only bit of UI state. */
  const endLive = () => {
    stopLive();
    if (bearingRef.current !== null) map?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    bearingRef.current = null;
    setLiveBearing(null);
    setPlaying(false);
    setLivePos(null);
    setLiveErr(null);
    setFarFromStart(null);
  };
  useEffect(() => () => stopLive(), []);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {}
    // Switching either way stops whatever walk is running (a demo walk would otherwise hang in live).
    endLive();
  };

  /** Start following the real position; returns false when geolocation can't be used at all. */
  const startLive = (): boolean => {
    setLiveErr(null);
    setFarFromStart(null);
    if (!navigator.geolocation || !window.isSecureContext) {
      setLiveErr("Sijaintia ei voi käyttää tällä yhteydellä (vaatii HTTPS-osoitteen). Kokeile demotilaa.");
      return false;
    }
    stopLive();
    // iOS only grants the compass when asked directly in the tap ("Aloita kävely").
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    DOE?.requestPermission?.().catch(() => {});
    window.addEventListener("deviceorientationabsolute", onOrientation.current as EventListener, true);
    window.addEventListener("deviceorientation", onOrientation.current as EventListener, true);
    let first = true;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setLivePos(p);
        setLiveErr(null);
        if (pos.coords.heading !== null && !Number.isNaN(pos.coords.heading) && (pos.coords.speed ?? 0) > 0.7) {
          gpsHeadingAt.current = performance.now();
          pushHeadingRef.current(pos.coords.heading);
        }
        const ctx = liveCtx.current;
        if (!ctx.adventure) return;
        if (first) {
          first = false;
          const d = distanceM(p, ctx.adventure.coords[0]);
          if (d > 1000) setFarFromStart(d);
        }
        ctx.stops.forEach((m, i) => {
          const id = `stop-${i}`;
          if (ctx.reached.includes(id) || distanceM(p, m.lngLat) > 30) return;
          ctx.reached = [...ctx.reached, id];
          setReachedIds((r) => (r.includes(id) ? r : [...r, id]));
          setOverview(false);
          setFocused(i);
          navigator.vibrate?.(200);
          setLiveAnnounce(`Saavuit: ${m.name}`);
        });
        const goal = ctx.adventure.coords[ctx.adventure.coords.length - 1];
        if (distanceM(p, goal) <= 30) {
          setArrived(true);
          setLiveAnnounce("Perillä! Hyvin harhailtu.");
          endLive();
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          endLive();
          setLiveErr("Sijainnin käyttö estettiin. Salli sijainti selaimen asetuksista tai vaihda demotilaan.");
          return;
        }
        // Timeouts / weak signal: keep watching, just tell the user.
        setLiveErr("Sijaintisignaali on heikko – yritetään edelleen…");
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return true;
  };

  /** "Aloita tästä": replan from the current GPS position, making it the new start. */
  const startHere = () => {
    if (!livePos || !end || !style) return;
    const a = { lngLat: livePos, name: "Oma sijainti" };
    setStart(a);
    void run(style, a, end, wander);
  };

  /** Live mode helper on the input step: use the device position as the start. */
  const locateMe = async () => {
    setLiveErr(null);
    // Geolocation only exists on https:// (or localhost); plain http on a LAN IP never even prompts.
    if (!window.isSecureContext || !navigator.geolocation) {
      setLiveErr(
        "Live-testi tarvitsee suojatun https-yhteyden, jotta selain voi kysyä sijaintiasi. Avaa sovellus https-osoitteesta tai käytä demotilaa.",
      );
      return;
    }
    setLocating(true);
    const p = await currentPosition(8000);
    setLocating(false);
    if (!p) {
      setLiveErr("Sijaintia ei saatu. Salli sijainti selaimessa tai valitse lähtö kartalta.");
      return;
    }
    void setPoint("start", p, "Oma sijainti");
    setActiveField("end");
    map?.easeTo({ center: p, zoom: Math.max(map.getZoom(), 15), duration: prefersReducedMotion() ? 0 : 800 });
  };
  const runRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Frame the map around whatever the panel currently covers (sidebar card or bottom sheet).
  const padding = (): MapPadding => {
    const base = defaultPadding();
    const r = panelRef.current?.getBoundingClientRect();
    if (!r) return base;
    return window.innerWidth >= 768
      ? { ...base, left: r.right + 40 }
      : (() => {
          // Use the height the sheet is heading to, not its current (possibly mid-transition)
          // height, so routes and stops aren't framed underneath it.
          const vh = window.innerHeight;
          const h = dragH ?? (liveWalking ? r.height : sheetHeights()[sheet]);
          return {
            ...base,
            top: 110,
            // + room for marker badges; keep at least ~100 px of map so fits never fail.
            bottom: Math.min(h + 48, vh - 110 - 100),
          };
        })();
  };

  // Glowing buildings along the route: fire-and-forget once the route has drawn; failures show nothing.
  useEffect(() => {
    // Building ages fit history; on a nature walk they're just noise.
    if (!adventure || adventure.style !== "historic") return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetchRouteBuildings(adventure.coords, ctrl.signal)
        .then((fc) => {
          if (!ctrl.signal.aborted) setBuildings(fc as BuildingCollection);
        })
        .catch(() => {});
    }, prefersReducedMotion() ? 0 : 2600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [adventure]);

  // Move focus to each new step's heading for keyboard and screen-reader users.
  useEffect(() => {
    if (step !== "input") headingRef.current?.focus();
  }, [step]);

  const near: LngLat = (() => {
    const c = map?.getCenter();
    return c ? [c.lng, c.lat] : DEFAULT_CENTER;
  })();

  // Latest name lookup per endpoint; snapping changes the coordinate, so identity checks don't work.
  const nameSeq = useRef({ start: 0, end: 0 });
  const setPoint = useCallback(async (which: "start" | "end", p: LngLat, name?: string) => {
    const set = which === "start" ? setStart : setEnd;
    const seq = ++nameSeq.current[which];
    set({ lngLat: p, name: name ?? "Haetaan nimeä…" });
    if (name) return;
    const found = await reverseName(p);
    if (nameSeq.current[which] !== seq) return;
    set((cur) => (cur ? { ...cur, name: found ?? `${p[1].toFixed(4)}, ${p[0].toFixed(4)}` } : cur));
  }, []);

  const run = useCallback(
    async (s: AdventureStyle, a: Endpoint, b: Endpoint, w: Wander, fixed?: LngLat[]) => {
      runRef.current?.abort();
      stopLive();
      setLivePos(null);
      setFarFromStart(null);
      setLiveErr(null);
      const ctrl = new AbortController();
      runRef.current = ctrl;
      setStyle(s);
      setStage("fetch");
      setPlaying(false);
      setReachedIds([]);
      setFocused(null);
      setArrived(false);
      setOverview(false);
      setStep("loading");
      try {
        const [adv] = await Promise.all([
          planAdventure(a.lngLat, b.lngLat, s, (st) => !ctrl.signal.aborted && setStage(st), {
            wander: w,
            signal: ctrl.signal,
            // `travel` is newer than some PlanOptions typings; spread keeps it compatible either way.
            ...({ travel: travelRef.current } as object),
            // A shared link carries its exact stops; reuse them instead of picking new ones.
            ...(fixed?.length ? ({ fixedStops: fixed.map((lngLat) => ({ lngLat })) } as object) : {}),
          }),
          wait(prefersReducedMotion() ? 0 : MIN_LOADING_MS),
        ]);
        if (ctrl.signal.aborted) return;
        // Snap the markers onto the walkable network (a tap in the sea otherwise looks odd).
        // Only if the user hasn't moved the point meanwhile.
        setStart((cur) => (cur && cur.lngLat === a.lngLat ? { ...cur, lngLat: adv.startSnapped } : cur));
        setEnd((cur) => (cur && cur.lngLat === b.lngLat ? { ...cur, lngLat: adv.endSnapped } : cur));
        setBuildings(null);
        setAdventure(adv);
        setStep("result");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Jokin meni pieleen. Yritä uudelleen.");
        setStep("error");
      }
    },
    [],
  );

  const launchToken = useRef(0);
  const begin = async (from: Endpoint | null = start, to: Endpoint | null = end) => {
    if (!from || !to) return;
    const token = ++launchToken.current;
    setStep("launch");
    const b = boundsOf([[from.lngLat, to.lngLat]]);
    if (map && b) {
      frameBounds(map, b, padding(), { maxZoom: 16, duration: prefersReducedMotion() ? 0 : 1200 });
    }
    await wait(prefersReducedMotion() ? 0 : LAUNCH_MS);
    // "Uusi retki" during the animation cancels the launch.
    if (launchToken.current === token) setStep("choose");
  };

  const restart = () => {
    launchToken.current++;
    runRef.current?.abort();
    endLive();
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {}
    setAdventure(null);
    setPlaying(false);
    setStep("input");
  };

  /** ↺ "Uusi retki": start completely over, including the start and destination. */
  const newTrip = () => {
    restart();
    // Invalidate pending name lookups so they can't refill the cleared fields.
    nameSeq.current.start++;
    nameSeq.current.end++;
    setStart(null);
    setEnd(null);
    setActiveField("start");
  };

  const onDragEnd = (which: "start" | "end", p: LngLat) => {
    void setPoint(which, p);
    // Re-plan straight away if a route is already on screen.
    if ((step === "result" || step === "loading") && style) {
      const a = which === "start" ? { lngLat: p, name: "" } : start;
      const b = which === "end" ? { lngLat: p, name: "" } : end;
      if (a && b) void run(style, a, b, wander);
    }
  };

  const tripLink = (): TripLink | null =>
    start && end && adventure
      ? {
          start: { lngLat: start.lngLat, label: start.name },
          end: { lngLat: end.lngLat, label: end.name },
          style: adventure.style,
          wander: adventure.wander,
          ...({ travel: travelRef.current, stops: adventure.stops.map((m) => m.lngLat) } as object),
        }
      : null;

  const onShare = async () => {
    const t = tripLink();
    if (!t) return;
    const res = await shareTrip(t);
    // Closing the native share sheet isn't an error; say nothing.
    if (res === "cancelled") return;
    setShareMsg(res === "copied" ? "Linkki kopioitu" : res === "shared" ? "Jaettu!" : "Jakaminen ei onnistunut");
    window.setTimeout(() => setShareMsg(null), 2600);
  };

  // Keep the address bar shareable once a route is on screen.
  useEffect(() => {
    if (step !== "result" || !adventure || !start || !end) return;
    try {
      window.history.replaceState(
        null,
        "",
        encodeTrip({
          start: { lngLat: start.lngLat, label: start.name },
          end: { lngLat: end.lngLat, label: end.name },
          style: adventure.style,
          wander: adventure.wander,
          ...({ travel: travelRef.current, stops: adventure.stops.map((m) => m.lngLat) } as object),
        }),
      );
    } catch {}
  }, [step, adventure, start, end]);

  // Opening a shared link: with a style, plan straight away; otherwise prefill and ask for the style.
  useEffect(() => {
    const t = decodeTrip(window.location.search);
    if (!t) return;
    const a = { lngLat: t.start.lngLat, name: t.start.label };
    const b = { lngLat: t.end.lngLat, name: t.end.label };
    const w = t.wander ?? 2;
    // Deferred so the initial render commits first.
    const id = window.setTimeout(() => {
      setStart(a);
      setEnd(b);
      setWander(w);
      const fixed = (t as { stops?: LngLat[] }).stops;
      if (t.style) void run(t.style, a, b, w, fixed);
      else setStep("choose");
    }, 0);
    return () => clearTimeout(id);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tooClose = !!start && !!end && distanceM(start.lngLat, end.lngLat) < 30;
  const styleInfo = STYLES.find((s) => s.id === style);
  // Stable identity: RouteLayers replays the draw animation (and re-frames the map) whenever
  // `routes` changes, so only rebuild it for a new adventure — not on every click or walk tick.
  const showRoute = step === "result";
  const previewOn = welcome && !!previewAdv && !adventure;
  const routes = useMemo<RouteViz[]>(
    () =>
      showRoute && adventure
        ? [
            { id: "fast", color: ROUTE_COLORS.fast, coords: adventure.fastCoords },
            { id: adventure.style, color: ROUTE_COLORS[adventure.style], coords: adventure.coords },
          ]
        : previewOn && previewAdv
          ? [{ id: previewAdv.style, color: ROUTE_COLORS[previewAdv.style], coords: previewAdv.coords }]
          : [],
    [showRoute, adventure, previewOn, previewAdv],
  );
  const previewStops = useMemo(() => (previewOn && previewAdv ? previewAdv.stops : []), [previewOn, previewAdv]);
  const previewImages = useStopImages(previewStops);
  /** Frame the example trip in the part of the screen the welcome panel leaves free. */
  const welcomePadding = (): MapPadding =>
    window.innerWidth >= 768
      ? { top: 90, right: 90, bottom: 90, left: Math.min(window.innerWidth * 0.5, 620) + 60 }
      : { top: 70, right: 40, bottom: Math.round(window.innerHeight * 0.6), left: 40 };
  const stops = useMemo(() => (showRoute && adventure ? adventure.stops : []), [showRoute, adventure]);
  const images = useStopImages(stops);
  const stopPois = stops.map((m, i) => ({
    id: `stop-${i}`,
    lngLat: m.lngLat,
    label: m.name,
    kind: m.kind,
    order: i + 1,
  }));
  const nextIdx = stops.findIndex((_, i) => !reachedIds.includes(`stop-${i}`));
  // Live walking: a compact bar (next + closest stop), expanding into the stop's card while you're at it.
  const liveWalking = isLive && playing && step === "result" && !!adventure;
  const unreached = stops.map((_, i) => i).filter((i) => !reachedIds.includes(`stop-${i}`));
  const distTo = (p: LngLat) => (livePos ? distanceM(livePos, p) : null);
  const closestIdx = livePos
    ? unreached.reduce<number | null>(
        (best, i) =>
          best === null || distanceM(livePos, stops[i].lngLat) < distanceM(livePos, stops[best].lngLat) ? i : best,
        null,
      )
    : null;
  const hereIdx = livePos ? stops.findIndex((m) => distanceM(livePos, m.lngLat) <= 50) : -1;
  // Turn-by-turn for live walking/driving.
  const maneuvers = useMemo(
    () => (adventure ? buildManeuvers(adventure.coords, adventure.stops.map((m) => ({ lngLat: m.lngLat, name: m.name }))) : []),
    [adventure],
  );
  const progress = liveWalking && livePos && adventure ? routeProgress(adventure.coords, livePos) : null;
  const turn = progress ? nextManeuver(maneuvers, progress.along) : null;

  const shownIdx = focused ?? (nextIdx === -1 ? null : nextIdx);
  const shown = shownIdx === null ? null : stops[shownIdx];
  const shownImage = shownIdx === null ? undefined : (shown?.image ?? images[shownIdx]);

  const flyToStop = (i: number) => {
    const p = stops[i]?.lngLat;
    if (!map || !p) return;
    centerOn(map, p, padding(), {
      zoom: Math.max(map.getZoom(), 16),
      duration: prefersReducedMotion() ? 0 : 1100,
    });
  };

  const showWholeRoute = () => {
    const b = adventure && boundsOf([adventure.coords]);
    if (map && b) frameBounds(map, b, padding(), { maxZoom: 16, duration: prefersReducedMotion() ? 0 : 1400 });
  };

  // Preview tour: visit every stop once, then zoom out to the whole route and stay there.
  const cyclePausedUntil = useRef(0);
  const passTimer = useRef(0);
  // Panning/zooming the map yourself pauses the preview tour instead of being yanked back.
  useEffect(() => {
    if (!map) return;
    const pause = () => (cyclePausedUntil.current = performance.now() + 15000);
    map.on("dragstart", pause);
    map.on("wheel", pause);
    map.on("touchstart", pause);
    return () => {
      map.off("dragstart", pause);
      map.off("wheel", pause);
      map.off("touchstart", pause);
    };
  }, [map]);
  useEffect(() => () => window.clearTimeout(passTimer.current), []);
  const tourDoneFor = useRef<Adventure | null>(null);
  useEffect(() => {
    if (!showRoute || playing || stops.length === 0 || tourDoneFor.current === adventure) return;
    let i = -1;
    let every = 0;
    const advance = () => {
      if (performance.now() < cyclePausedUntil.current) return;
      i += 1;
      if (i >= stops.length) {
        clearInterval(every);
        tourDoneFor.current = adventure;
        setFocused(null);
        setOverview(true);
        showWholeRoute();
        return;
      }
      setOverview(false);
      setFocused(i);
      flyToStop(i);
    };
    // Let the route finish drawing before the tour starts; the interval only begins at the first
    // stop, so every stop (including the first) gets the full time on screen.
    const first = setTimeout(
      () => {
        advance();
        every = window.setInterval(advance, TOUR_STOP_MS);
      },
      prefersReducedMotion() ? 1500 : 3400,
    );
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
    // flyToStop/showWholeRoute only read refs/state that the tour shouldn't restart for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoute, playing, stops, adventure]);

  const focusStop = (i: number, delayMs = 0) => {
    // A deliberate pick pauses the tour for a while; just focus — no redraw.
    cyclePausedUntil.current = performance.now() + 15000;
    setOverview(false);
    setFocused(i);
    if (playing) return;
    if (delayMs) setTimeout(() => flyToStop(i), delayMs);
    else flyToStop(i);
  };

  const heroImage = overview ? images.find(Boolean) : shownImage;

  return (
    <>
      {/* Until the stored mode / link is read, a plain cover avoids flashing the welcome or the planner. */}
      {!modeLoaded && <div className="wl-cover" aria-hidden />}
      {welcome && modeLoaded && (
        <WelcomeScreen
          last={mode}
          onPick={(m) => {
            // Live: ask for the device location right in the tap and use it as the start.
            if (m === "live" && !start) void locateMe();
          }}
          travel={travel}
          onTravel={setTravel}
          onChoose={(m) => {
            setMode(m);
            setWelcome(false);
            // Glide from the example trip back to the city for planning.
            // (Live mode centres on the GPS position instead, once it arrives.)
            if (step === "input" && map && m !== "live" && !prefersReducedMotion())
              map.flyTo({ center: DEFAULT_CENTER, zoom: 14, speed: 0.8, curve: 1.4, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
            if (step === "input")
              window.setTimeout(() => panelRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 50);
          }}
        />
      )}
      <RouteLayers
        routes={routes}
        selectedId={previewOn ? (previewAdv?.style ?? null) : (adventure?.style ?? null)}
        padding={previewOn ? welcomePadding : padding}
        dimOthers={false}
        crazy={step === "result" && adventure?.wander === 11}
      />
      <PhotoPins
        pins={previewStops.map((m, i) => ({ id: `p${i}`, lngLat: m.lngLat, name: m.name, image: previewImages[i] }))}
      />
      <BuildingGlow data={step === "result" && adventure?.style === "historic" ? buildings : null} />
      <EndpointMarkers start={start?.lngLat ?? null} end={end?.lngLat ?? null} onDragEnd={onDragEnd} />
      <PoiMarkers
        pois={stopPois}
        activeId={shownIdx === null ? null : `stop-${shownIdx}`}
        onClick={(id) => focusStop(Number(id.split("-")[1]))}
      />
      <Walker
        key={walkKey}
        crazy={adventure?.wander === 11}
        car={car}
        speed={walkSpeed(adventure?.distanceM ?? 0)}
        coords={step === "result" ? (adventure?.coords ?? null) : null}
        livePosition={isLive ? livePos : undefined}
        liveBearing={isLive && headingUp ? liveBearing : null}
        playing={playing}
        pois={stopPois}
        onPoiReached={(id) => {
          setReachedIds((r) => [...r, id]);
          setOverview(false);
          // Show the stop we're passing (photo + description) for a moment; a minimised sheet pops up.
          setFocused(Number(id.split("-")[1]));
          const popped = sheet === "peek";
          if (popped) setSheet("half");
          window.clearTimeout(passTimer.current);
          passTimer.current = window.setTimeout(() => {
            setFocused(null);
            if (popped) setSheet((s) => (s === "half" ? "peek" : s));
          }, PASSING_STOP_MS);
        }}
        onDone={() => {
          setPlaying(false);
          setArrived(true);
        }}
        padding={padding}
      />
      {step === "input" && !welcome && (
        <MapClick
          onClick={(p) => {
            // Fill the first empty field (start before destination); otherwise the focused one.
            const target = !start ? "start" : !end ? "end" : activeField;
            void setPoint(target, p);
            if (target === "start") setActiveField("end");
          }}
        />
      )}

      <section
        ref={panelRef}
        aria-label="Retken suunnittelu"
        // Behind the welcome screen the planner must not be reachable (mouse or keyboard).
        inert={welcome}
        className={`flow-panel flow-sheet-${liveWalking ? "live" : sheet} ${dragH !== null ? "is-dragging" : ""} ${
          step === "result" ? "flow-panel--result" : ""
        }`}
        style={
          dragH !== null
            ? { height: dragH, maxHeight: "none" }
            : settleH !== null
              ? { height: settleH, maxHeight: "none" }
              : undefined
        }
      >
        <button
          type="button"
          className="flow-handle-zone"
          aria-label={
            sheet === "peek" ? "Suurenna paneeli" : sheet === "half" ? "Laajenna koko näytölle" : "Pienennä paneeli"
          }
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onClick={(e) => {
            // Keyboard (Enter/Space) clicks have detail 0; pointer taps are handled in onHandleUp.
            if (e.detail === 0) cycleSheet();
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragH(null);
          }}
        >
          <span className="flow-handle" aria-hidden />
        </button>


        <div aria-live="polite" className="sr-only">
          {step === "launch" && "Retki alkaa."}
          {step === "choose" && "Valitse seikkailun tyyppi."}
          {step === "loading" && STAGE_TEXT[stage]}
          {step === "result" && adventure && `Reitti valmis: ${withHours(adventure.story)}`}
          {step === "error" && error}
          {liveAnnounce}
        </div>

        <div key={step} className="flow-step">
          {step === "input" && (
            <div className="flex flex-col gap-3">
              <PlaceInput
                label="Lähtö"
                placeholder="Hae paikkaa tai napauta karttaa"
                value={start?.name ?? ""}
                near={near}
                marker="start"
                active={activeField === "start"}
                onFocus={() => setActiveField("start")}
                onPick={(p: Place) => {
                  void setPoint("start", p.lngLat, p.name);
                  setActiveField("end");
                }}
                onClear={() => {
                  setStart(null);
                  setActiveField("start");
                }}
              />
              <PlaceInput
                label="Määränpää"
                placeholder="Minne matka?"
                value={end?.name ?? ""}
                near={near}
                marker="end"
                active={activeField === "end"}
                onFocus={() => setActiveField("end")}
                onPick={(p: Place) => void setPoint("end", p.lngLat, p.name)}
                onClear={() => {
                  setEnd(null);
                  if (start) setActiveField("end");
                }}
              />
              {isLive && (
                <button type="button" className="flow-ghost-btn self-start" onClick={locateMe} disabled={locating}>
                  <svg aria-hidden viewBox="0 0 20 20" className="mr-1.5 size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="10" cy="10" r="3" />
                    <path d="M10 2v3m0 10v3M2 10h3m10 0h3" />
                  </svg>
                  {locating ? "Haetaan sijaintia…" : "Käytä sijaintiani lähtönä"}
                </button>
              )}
              {liveErr && step === "input" && (
                <p role="alert" className="text-sm text-[var(--coral)]">
                  {liveErr}
                </p>
              )}
              <p className="text-xs text-[var(--ink-soft)]">
                Vinkki: napauta karttaa valitaksesi{" "}
                {(!start ? "start" : !end ? "end" : activeField) === "start" ? "lähtöpisteen" : "määränpään"}.
              </p>
              {tooClose && (
                <p role="alert" className="text-sm text-[var(--coral)]">
                  Lähtö ja määränpää ovat lähes samassa paikassa. Valitse määränpää kauempaa.
                </p>
              )}
              <button
                type="button"
                className="flow-cta"
                disabled={!start || !end || tooClose}
                onClick={() => {
                  void begin();
                }}
              >
                Aloita retki
                <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10h11m-4-4 4 4-4 4" />
                </svg>
              </button>
              {modeLoaded && (
                <button type="button" className="flow-mode-link" onClick={() => setWelcome(true)}>
                  Muuta asetuksia
                </button>
              )}
            </div>
          )}

          {step === "launch" && (
            <div className="flow-launch" role="presentation">
              <div className="flow-launch-rings" aria-hidden>
                <span />
                <span />
                <span />
                <svg viewBox="0 0 64 64" className="flow-launch-compass">
                  <circle cx="32" cy="32" r="26" fill="#fff" stroke="var(--sea-deep)" strokeWidth="3" />
                  <path d="M32 12 38 32H26Z" fill="var(--coral)" />
                  <path d="M32 52 26 32h12Z" fill="var(--sea-deep)" />
                  <circle cx="32" cy="32" r="3" fill="#fff" />
                </svg>
              </div>
              <h2 ref={headingRef} tabIndex={-1} className="flow-title outline-none">
                Retki alkaa!
              </h2>
              <p className="text-sm text-[var(--ink-soft)]">
                {start?.name} → {end?.name}
              </p>
            </div>
          )}

          {step === "choose" && (
            <div className="flex flex-col gap-3">
              <h2 ref={headingRef} tabIndex={-1} className="flow-title outline-none">
                Millaisen seikkailun haluat?
              </h2>
              <button type="button" className="flow-mode-link self-start" onClick={restart}>
                ← Vaihda paikkoja
              </button>
              <WanderDial value={wander} onChange={setWander} />
              <div className="flex flex-col gap-2">
                {STYLES.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className="flow-option"
                    style={{ "--accent": s.color, animationDelay: `${i * 90}ms` } as React.CSSProperties}
                    onClick={() => start && end && run(s.id, start, end, wander)}
                  >
                    <span className="flow-option-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                        {s.icon}
                      </svg>
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block font-semibold text-[var(--ink)]">{s.title}</span>
                      <span className="block text-sm text-[var(--ink-soft)]">{s.text}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "loading" && (
            <div className="flow-loading" style={{ "--accent": styleInfo?.color } as React.CSSProperties}>
              <svg viewBox="0 0 240 70" className="w-full max-w-[280px]" aria-hidden>
                <path
                  className="flow-trail-bg"
                  d="M14 52C50 52 52 14 92 18s40 38 78 34 42-30 56-34"
                  fill="none"
                />
                <path
                  className="flow-trail"
                  pathLength={1}
                  d="M14 52C50 52 52 14 92 18s40 38 78 34 42-30 56-34"
                  fill="none"
                />
                <circle cx="14" cy="52" r="6" fill="#fff" stroke="var(--sea-deep)" strokeWidth="3.5" />
                <path d="M226 18c0 0-7-8-7-12a7 7 0 0 1 14 0c0 4-7 12-7 12Z" fill="var(--sea-deep)" />
                <circle className="flow-trail-dot" r="5" />
              </svg>
              <h2 ref={headingRef} tabIndex={-1} className="flow-title outline-none">
                {styleInfo?.title}
              </h2>
              <p key={stage} className="flow-stage text-sm text-[var(--ink-soft)]">
                {(wander === 11 ? CRAZY_STAGE_TEXT : STAGE_TEXT)[stage]}
              </p>
            </div>
          )}

          {liveWalking && adventure && (
            <div className="flow-live">
              {progress && (progress.offRoute > 40 || turn) && (
                <div className={`flow-turn ${progress.offRoute > 40 ? "is-off" : ""}`} aria-live="polite">
                  <span className="flow-turn-icon" aria-hidden>
                    {progress.offRoute > 40 ? "↺" : turn!.m.icon}
                  </span>
                  <span className="min-w-0">
                    {progress.offRoute > 40 ? (
                      <>
                        <span className="flow-turn-dist">Palaa reitille</span>
                        <span className="flow-turn-text">{fmtDistance(progress.offRoute)} reitiltä</span>
                      </>
                    ) : (
                      <>
                        <span className="flow-turn-dist">{fmtDistance(turn!.dist)}</span>
                        <span className="flow-turn-text">{turn!.m.text}</span>
                      </>
                    )}
                  </span>
                </div>
              )}
              {!livePos ? (
                <p className="flow-live-wait">
                  <span className="flow-live-dot" aria-hidden /> Haetaan sijaintia…
                </p>
              ) : hereIdx !== -1 ? (
                <article key={`here-${hereIdx}`} className="flow-live-here">
                  {images[hereIdx] && (
                    <div className="flow-hero">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={images[hereIdx]} alt="" />
                    </div>
                  )}
                  <div className="flow-desc">
                    <p className="flow-desc-label">
                      Olet täällä · Pysähdys {hereIdx + 1}/{stops.length} · {stops[hereIdx].kind}
                    </p>
                    <p className="flow-desc-title">{stops[hereIdx].name}</p>
                    {stops[hereIdx].blurb && <p className="flow-desc-text">{stops[hereIdx].blurb}</p>}
                    {stops[hereIdx].wikiUrl && (
                      <a href={stops[hereIdx].wikiUrl} target="_blank" rel="noopener noreferrer" className="flow-desc-link">
                        Lue lisää Wikipediasta
                      </a>
                    )}
                  </div>
                </article>
              ) : (
                <ul className="flow-live-list">
                  {nextIdx !== -1 ? (
                    <LiveRow
                      label={`Seuraava pysähdys ${nextIdx + 1}/${stops.length}`}
                      name={stops[nextIdx].name}
                      image={images[nextIdx]}
                      num={nextIdx + 1}
                      dist={distTo(stops[nextIdx].lngLat)}
                    />
                  ) : (
                    <LiveRow
                      label={arrived ? "Perillä! Hyvin harhailtu." : "Kohti määränpäätä"}
                      name={end?.name ?? "Määränpää"}
                      num="⚑"
                      dist={distTo(adventure.coords[adventure.coords.length - 1])}
                    />
                  )}
                  {closestIdx !== null && closestIdx !== nextIdx && (
                    <LiveRow
                      label="Lähin kohde"
                      name={stops[closestIdx].name}
                      image={images[closestIdx]}
                      num={closestIdx + 1}
                      dist={distTo(stops[closestIdx].lngLat)}
                    />
                  )}
                </ul>
              )}
              {liveErr && (
                <div role="alert" className="flow-live-note">
                  <p>{liveErr}</p>
                  <button type="button" className="flow-ghost-btn" onClick={() => setMode("demo")}>
                    Vaihda demotilaan
                  </button>
                </div>
              )}
              {farFromStart !== null && (
                <div role="alert" className="flow-live-note">
                  <p>Olet {fmtDist(farFromStart)} päässä reitin alusta.</p>
                  <button
                    type="button"
                    className="flow-ghost-btn"
                    onClick={() =>
                      startHere()
                    }
                  >
                    Aloita tästä
                  </button>
                </div>
              )}
              <button
                type="button"
                className="flow-compass-btn"
                aria-pressed={headingUp}
                aria-label={headingUp ? "Kulkusuunta ylös – vaihda pohjoinen ylös" : "Pohjoinen ylös – vaihda kulkusuunta ylös"}
                title={headingUp ? "Kulkusuunta ylös" : "Pohjoinen ylös"}
                onClick={() => setHeadingUp((h) => !h)}
              >
                <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="10" cy="10" r="8" />
                  <path d="m10 4 2.5 6h-5z" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <button
                type="button"
                className="flow-cta w-full"
                onClick={endLive}
              >
                {car ? "Lopeta ajo" : "Lopeta kävely"}
              </button>
            </div>
          )}

          {!liveWalking && step === "result" && adventure && styleInfo && (
            <div className="flex flex-col gap-3">
              <h2 ref={headingRef} tabIndex={-1} className="sr-only">
                {styleInfo.title}
              </h2>
              <dl className="flow-stats flow-collapsible" style={{ "--accent": styleInfo.color } as React.CSSProperties}>
                <div>
                  <dt>
                    <span className="flow-legend-line" aria-hidden />
                    Retki
                  </dt>
                  <dd>{formatDuration(adventure.durationMin)}</dd>
                </div>
                <div>
                  <dt>
                    <span className="flow-legend-line flow-legend-line--fast" aria-hidden />
                    Nopein
                  </dt>
                  <dd>{formatDuration(adventure.fastMin)}</dd>
                </div>
                <div>
                  <dt>Matka</dt>
                  <dd>{formatKm(adventure.distanceM)}</dd>
                </div>
                <div className={adventure.wander === 11 ? "flow-stat-level--eleven" : ""}>
                  <dt>Taso</dt>
                  <dd title={WANDER_LABELS[adventure.wander]}>{adventure.wander}</dd>
                </div>
              </dl>

              <article
                key={overview ? "overview" : shown ? `stop-${shownIdx}` : "arrival"}
                className="flow-stop-card flow-collapsible"
                aria-live="polite"
              >
                <div className="flow-hero">
                  {heroImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={heroImage} alt="" />
                  ) : (
                    <span className="flow-hero-empty" aria-hidden>
                      {overview || !shown ? (
                        <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 21V4m0 0h10l-2 3.5L16 11H6" />
                        </svg>
                      ) : (
                        shownIdx! + 1
                      )}
                    </span>
                  )}
                  {!overview && shown && stops.length > 1 && (
                    <>
                      <span className="flow-hero-count">
                        {shownIdx! + 1}/{stops.length}
                      </span>
                      <button
                        type="button"
                        className="flow-hero-nav flow-hero-nav--prev"
                        aria-label="Edellinen pysähdys"
                        onClick={() => focusStop((shownIdx! - 1 + stops.length) % stops.length)}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="flow-hero-nav flow-hero-nav--next"
                        aria-label="Seuraava pysähdys"
                        onClick={() => focusStop((shownIdx! + 1) % stops.length)}
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>
                <div className="flow-desc">
                  {overview ? (
                    <>
                      <p className="flow-desc-label">
                        {styleInfo.title} · {stops.length} {stops.length === 1 ? "pysähdys" : "pysähdystä"}
                      </p>
                      <p className="flow-desc-title">Koko retki</p>
                      <p className="flow-desc-text">{withHours(adventure.story)}</p>
                    </>
                  ) : shown ? (
                    <>
                      <p className="flow-desc-label">
                        {focused === null && playing ? "Seuraava pysähdys" : `Pysähdys ${shownIdx! + 1}`}
                        {isLive && livePos && !reachedIds.includes(`stop-${shownIdx}`)
                          ? ` · ${fmtDist(distanceM(livePos, shown.lngLat))}`
                          : ` · ${shown.kind}`}
                      </p>
                      <p className="flow-desc-title">{shown.name}</p>
                      {shown.blurb && <p className="flow-desc-text">{shown.blurb}</p>}
                      {shown.wikiUrl && (
                        <a href={shown.wikiUrl} target="_blank" rel="noopener noreferrer" className="flow-desc-link">
                          Lue lisää Wikipediasta
                        </a>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="flow-desc-label">{arrived ? "Retki valmis" : "Kaikki pysähdykset nähty"}</p>
                      <p className="flow-desc-title">
                        {arrived ? "Perillä! Hyvin harhailtu." : `Kohti määränpäätä: ${end?.name ?? ""}`}
                      </p>
                    </>
                  )}
                </div>
              </article>

              <div className="flow-share-row flow-collapsible">
                <button type="button" className="flow-ghost-btn" onClick={onShare}>
                  <svg aria-hidden viewBox="0 0 20 20" className="mr-1.5 size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 11v4.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V11" />
                  </svg>
                  Jaa retki
                </button>
                <span aria-live="polite" className="text-sm font-medium text-[var(--sea)]">
                  {shareMsg}
                </span>
              </div>

              {stops.length > 1 && (
                <section className="flow-collapsible" aria-label="Kaikki pysähdykset">
                  <h3 className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">
                    Kaikki pysähdykset ({stops.length})
                  </h3>
                  <ol className="flow-stops">
                    {stops.map((m, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          aria-current={!overview && i === shownIdx ? "true" : undefined}
                          aria-label={`${i + 1}. ${m.name}, ${m.kind}${reachedIds.includes(`stop-${i}`) ? ", käyty" : ""}`}
                          onClick={() => {
                            setSheet("half");
                            // Fly after the sheet has shrunk, so the padding matches what's visible.
                            focusStop(i, sheet === "half" ? 0 : 300);
                          }}
                          className={`flow-stop-row ${reachedIds.includes(`stop-${i}`) ? "is-reached" : ""} ${
                            !overview && i === shownIdx ? "is-current" : ""
                          }`}
                        >
                          {images[i] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={images[i]} alt="" className="flow-stop-thumb" />
                          ) : (
                            <span className="flow-stop-thumb flow-stop-thumb--empty" aria-hidden>
                              {i + 1}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[var(--ink)]">
                              {i + 1}. {m.name}
                            </span>
                            <span className="block truncate text-xs text-[var(--ink-faint)]">{m.kind}</span>
                          </span>
                          {reachedIds.includes(`stop-${i}`) && (
                            <span className="text-sm text-[var(--gold)]" aria-label="käyty">
                              ✓
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <button type="button" className="flow-mode-link flow-collapsible" onClick={() => setWelcome(true)}>
                Muuta asetuksia
              </button>

              <div className="flow-actions">
                {liveErr && (
                  <div role="alert" className="flow-live-note">
                    <p>{liveErr}</p>
                    <button type="button" className="flow-ghost-btn" onClick={() => setMode("demo")}>
                      Vaihda demotilaan
                    </button>
                  </div>
                )}
                {farFromStart !== null && (
                  <div role="alert" className="flow-live-note">
                    <p>Olet {fmtDist(farFromStart)} päässä reitin alusta.</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="flow-ghost-btn"
                        onClick={() =>
                          startHere()
                        }
                      >
                        Aloita tästä
                      </button>
                      <button type="button" className="flow-ghost-btn" onClick={() => setMode("demo")}>
                        Demotila
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                <button
                  type="button"
                  className="flow-cta flex-1"
                  onClick={() => {
                    if (isLive) {
                      if (playing) {
                        stopLive();
                        setPlaying(false);
                      } else if (startLive()) {
                        setFocused(null);
                        setOverview(false);
                        tourDoneFor.current = adventure;
                        setPlaying(true);
                      }
                      return;
                    }
                    if (arrived) {
                      // Start over from the beginning.
                      setWalkKey((k) => k + 1);
                      setReachedIds([]);
                      setArrived(false);
                    }
                    if (!playing) {
                      setFocused(null);
                      setOverview(false);
                      // Once the user walks, the preview tour must not restart afterwards.
                      tourDoneFor.current = adventure;
                    }
                    setPlaying((p) => !p);
                  }}
                >
                  {isLive
                    ? playing
                      ? car
                        ? "Lopeta ajo"
                        : "Lopeta kävely"
                      : car
                        ? "Aloita ajo"
                        : "Aloita kävely"
                    : playing
                      ? "Pysähdy"
                      : arrived
                        ? car
                          ? "Aja uudelleen"
                          : "Kävele uudelleen"
                        : car
                          ? "Aja reitti"
                          : "Kävele reitti"}
                </button>
                <button type="button" className="flow-secondary" onClick={() => setStep("choose")}>
                  Muuta retkeä
                </button>
                {/* Phones hide the header (and its "Uusi retki") in the result view. */}
                <button type="button" className="flow-secondary flow-restart-mobile" onClick={newTrip} aria-label="Uusi retki">
                  <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3" />
                  </svg>
                </button>
                </div>
                <Credits />
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col gap-3">
              <h2 ref={headingRef} tabIndex={-1} className="flow-title outline-none">
                Retki jäi satamaan
              </h2>
              <p className="text-sm text-[var(--ink-soft)]">{error}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flow-cta flex-1"
                  onClick={() => style && start && end && run(style, start, end, wander)}
                >
                  Yritä uudelleen
                </button>
                <button
                  type="button"
                  className="flow-secondary"
                  onClick={() => {
                    setStart(EXAMPLE_TRIP.start);
                    setEnd(EXAMPLE_TRIP.end);
                    void run(style ?? "surprise", EXAMPLE_TRIP.start, EXAMPLE_TRIP.end, wander);
                  }}
                >
                  Kokeile esimerkkiretkeä
                </button>
              </div>
              <button type="button" className="flow-mode-link self-start" onClick={restart}>
                ← Vaihda paikkoja
              </button>
            </div>
          )}
        </div>
        {/* Phones hide MapLibre's attribution control; the result view shows it in its sticky footer. */}
        {step !== "result" && <Credits />}
      </section>
    </>
  );
}
