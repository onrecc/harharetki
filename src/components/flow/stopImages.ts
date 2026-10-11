"use client";

import { useEffect, useState } from "react";
import type { Midstop } from "@/lib/routing/adventure";

/**
 * Finds a photo for stops that came without one: first a nearby Finnish Wikipedia article whose
 * title matches the stop, then a Wikimedia Commons photo taken right at the spot.
 */
const cache = new Map<string, Promise<string | undefined>>();

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();

function titleMatches(title: string, name: string) {
  const t = norm(title);
  const n = norm(name);
  if (!t || !n) return false;
  if (t.includes(n) || n.includes(t)) return true;
  // Share a distinctive word ("Havis Amanda" ~ "Havis Amandan patsas").
  return n.split(" ").some((w) => w.length >= 5 && t.includes(w));
}

type GeoPages = { query?: { pages?: Record<string, { title: string; thumbnail?: { source: string } }> } };
type CommonsPages = {
  query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; mime?: string }[] }> };
};

async function json<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function lookup(stop: Midstop): Promise<string | undefined> {
  const [lng, lat] = stop.lngLat;
  const signal = AbortSignal.timeout(6000);

  const wiki = await json<GeoPages>(
    `https://fi.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch` +
      `&ggscoord=${lat}|${lng}&ggsradius=120&ggslimit=8&prop=pageimages&piprop=thumbnail&pithumbsize=400`,
    signal,
  );
  const pages = Object.values(wiki?.query?.pages ?? {});
  const hit = pages.find((p) => p.thumbnail && titleMatches(p.title, stop.name));
  if (hit?.thumbnail) return hit.thumbnail.source;

  const commons = await json<CommonsPages>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch` +
      `&ggsnamespace=6&ggscoord=${lat}|${lng}&ggsradius=35&ggslimit=5&prop=imageinfo&iiprop=url|mime&iiurlwidth=400`,
    signal,
  );
  const photo = Object.values(commons?.query?.pages ?? {})
    .flatMap((p) => p.imageinfo ?? [])
    .find((i) => i.thumburl && (i.mime === "image/jpeg" || i.mime === "image/png"));
  return photo?.thumburl;
}

/** Index-aligned image URLs for `stops` (undefined while loading or when nothing fits). */
export function useStopImages(stops: Midstop[]): (string | undefined)[] {
  const [found, setFound] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    let alive = true;
    for (const s of stops) {
      if (s.image) continue;
      const key = `${s.lngLat[0]},${s.lngLat[1]}`;
      let p = cache.get(key);
      if (!p) {
        p = lookup(s);
        cache.set(key, p);
      }
      p.then((url) => {
        if (alive && url) setFound((f) => (f[key] === url ? f : { ...f, [key]: url }));
      });
    }
    return () => {
      alive = false;
    };
  }, [stops]);

  return stops.map((s) => s.image ?? found[`${s.lngLat[0]},${s.lngLat[1]}`]);
}
