import type { AdventureStyle, Wander } from "@/lib/routing/adventure";
import type { LngLat } from "@/lib/routing/geo";

/** A trip that fits in a URL: `?a=60.17070,24.94310&an=Rautatientori&b=…&bn=…&tyyli=historic&taso=2`. */
export interface TripLink {
  start: { lngLat: LngLat; label: string };
  end: { lngLat: LngLat; label: string };
  style?: AdventureStyle;
  wander?: Wander;
  /** "car" for driving trips; walking when absent. */
  travel?: "walk" | "car";
  /** Exact stops in walking order, so a shared link reproduces the same trip. */
  stops?: LngLat[];
}

const STYLES: AdventureStyle[] = ["scenic", "historic", "surprise"];
const WANDERS: Wander[] = [1, 2, 3, 4, 5, 11];

/** Cut by characters, not UTF-16 units, so emoji survive. */
const clip = (s: string | null) => (s ? Array.from(s).slice(0, 80).join("") : "");

const fmt = ([lng, lat]: LngLat) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

function parsePoint(s: string | null): LngLat | null {
  if (!s) return null;
  const parts = s.split(",");
  // Number("") is 0 — an empty part must not become the Gulf of Guinea.
  if (parts.length !== 2 || parts.some((x) => x.trim() === "")) return null;
  const [lat, lng] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

/** Query string for a trip (starts with "?"). */
export function encodeTrip(t: TripLink): string {
  const q = new URLSearchParams();
  q.set("a", fmt(t.start.lngLat));
  if (t.start.label) q.set("an", t.start.label);
  q.set("b", fmt(t.end.lngLat));
  if (t.end.label) q.set("bn", t.end.label);
  if (t.style) q.set("tyyli", t.style);
  if (t.wander) q.set("taso", String(t.wander));
  if (t.travel === "car") q.set("kulku", "auto");
  if (t.stops?.length) q.set("p", t.stops.slice(0, 15).map(fmt).join(";"));
  return `?${q.toString()}`;
}

/** Parse a trip from `location.search`; null when the link has no valid start and end. */
export function decodeTrip(search: string): TripLink | null {
  const q = new URLSearchParams(search);
  const a = parsePoint(q.get("a"));
  const b = parsePoint(q.get("b"));
  if (!a || !b) return null;
  const style = q.get("tyyli") as AdventureStyle | null;
  const wander = Number(q.get("taso")) as Wander;
  return {
    start: { lngLat: a, label: clip(q.get("an")) || "Lähtöpiste" },
    end: { lngLat: b, label: clip(q.get("bn")) || "Määränpää" },
    style: style && STYLES.includes(style) ? style : undefined,
    wander: WANDERS.includes(wander) ? wander : undefined,
    travel: q.get("kulku") === "auto" ? "car" : undefined,
    stops: (() => {
      const pts = (q.get("p") ?? "").split(";").map(parsePoint).filter((x): x is LngLat => !!x);
      return pts.length ? pts.slice(0, 15) : undefined;
    })(),
  };
}

/** Full shareable URL for the current page. */
export function tripUrl(t: TripLink): string {
  return `${window.location.origin}${window.location.pathname}${encodeTrip(t)}`;
}

/** Native share sheet on phones, clipboard elsewhere. Resolves to what happened. */
export async function shareTrip(t: TripLink, title = "Harharetki"): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = tripUrl(t);
  const text = `${t.start.label} → ${t.end.label} – lähdetkö harharetkelle?`;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch (e) {
    // The user closed the share sheet themselves — not an error worth showing.
    if ((e as Error)?.name === "AbortError") return "cancelled";
    try {
      await navigator.clipboard.writeText(url);
      return "copied";
    } catch {
      return "failed";
    }
  }
}
