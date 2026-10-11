import { coversDemo, loadGraph, LoadError, type LoadStage } from "@/lib/osm/load";
import {
  AdventureError,
  computeAdventure,
  tellStory,
  type Adventure,
  type AdventureStyle,
  type Midstop,
  type Wander,
} from "./adventure-core";
import { computeLongAdventure, mergePois } from "./adventure-long";
import { classify, cleanTitle, wikiPois } from "@/lib/osm/wikipedia";
import { haversine, type LngLat } from "./geo";
import type { Poi } from "./poi";

export type { Adventure, AdventurePoi, AdventureStyle, Midstop, Wander } from "./adventure-core";
export { WANDER_LABELS } from "./adventure-core";
export type { LoadStage } from "@/lib/osm/load";

interface WikiSummary {
  title?: string;
  description?: string;
  extract?: string;
  thumbnail?: { source: string };
  content_urls?: { desktop?: { page: string } };
}

interface WikidataEntity {
  sitelinks?: Record<string, { title: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] };
}

/** Follow an OSM `wikidata` link: find a Wikipedia article, or at least a description and photo. */
async function withWikidata(m: Midstop): Promise<Midstop> {
  if (m.wikipedia || !m.wikidata) return m;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&ids=${m.wikidata}&props=sitelinks|descriptions|claims&languages=fi|en&sitefilter=fiwiki|enwiki`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return m;
    const e = ((await res.json()) as { entities?: Record<string, WikidataEntity> }).entities?.[m.wikidata];
    if (!e) return m;
    const fi = e.sitelinks?.fiwiki?.title;
    const en = e.sitelinks?.enwiki?.title;
    const desc = e.descriptions?.fi?.value ?? e.descriptions?.en?.value;
    const file = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    const sentence = desc ? `${desc[0].toUpperCase()}${desc.slice(1)}.` : undefined;
    return {
      ...m,
      wikipedia: fi ? `fi:${fi}` : en ? `en:${en}` : undefined,
      blurb: m.blurb ?? sentence,
      image:
        m.image ??
        (file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=480` : undefined),
    };
  } catch {
    return m;
  } finally {
    clearTimeout(timer);
  }
}

/** Wikidata first (it may lead to an article), then the Wikipedia summary. Never throws. */
async function enrichStop(m: Midstop): Promise<Midstop> {
  return withWikipedia(await withWikidata(m));
}

/** Enrich the midstop with a Wikipedia summary when OSM links one. Never throws. */
async function withWikipedia(m: Midstop): Promise<Midstop> {
  if (!m.wikipedia) return m;
  const [origLang, ...rest] = m.wikipedia.split(":");
  let lang = origLang;
  let title = rest.join(":");
  if (!lang || !title || lang.length > 3) return m;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    // Prefer the Finnish article, then English; only fall back to e.g. Swedish when neither exists.
    for (const want of ["fi", "en"]) {
      if (lang === "fi" || lang === want) break;
      const ll = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=langlinks&lllang=${want}&titles=${encodeURIComponent(title)}`,
        { signal: ctrl.signal },
      )
        .then((r) => r.json())
        .catch(() => null);
      const pages = ll?.query?.pages ?? {};
      const hit = (Object.values(pages)[0] as { langlinks?: { "*": string }[] } | undefined)?.langlinks?.[0]?.["*"];
      if (hit) {
        lang = want;
        title = hit;
        break;
      }
    }
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return m;
    const w = (await res.json()) as WikiSummary;
    const extract = w.extract?.trim();
    // Stops found via (English) Wikipedia take the Finnish title and a category from the Finnish text.
    const fromWiki = m.id.startsWith("wiki:") && lang === "fi" && !!w.title;
    const fiName = fromWiki ? cleanTitle(w.title!) : m.name;
    const [kind, cat] = fromWiki ? classify(fiName, w.description) : [m.kind, m.cat];
    return {
      ...m,
      name: fiName,
      kind,
      cat,
      // The app speaks Finnish: show Finnish or English text, never e.g. a Swedish summary.
      blurb:
        extract && (lang === "fi" || lang === "en")
          ? extract.length > 320
            ? `${extract.slice(0, extract.lastIndexOf(" ", 300))}…`
            : extract
          : m.blurb,
      image: w.thumbnail?.source ?? m.image,
      wikiUrl: w.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return m;
  } finally {
    clearTimeout(timer);
  }
}

/** Live in-browser graph routing is used up to this distance outside the bundled area. */
const LIVE_GRAPH_MAX_M = 1800;
const DEMO_GRAPH_MAX_M = 6000;

export interface PlanOptions {
  /** How far the route may stray: 1 (a little) … 5, or 11 (completely lost). Default 2. */
  wander?: Wander;
  /** Walking (default) or driving. Driving always uses Valhalla car routing. */
  travel?: "walk" | "car";
  /** Reproduce exact stops (from a shared link) instead of choosing new ones. */
  fixedStops?: { lngLat: LngLat; name?: string }[];
  signal?: AbortSignal;
}

/**
 * Plans an adventure from `start` to `end` in the chosen style. The route passes through every stop.
 * Short trips use the in-browser routing engine on raw OSM data; longer ones use Valhalla (OSM routing).
 * Rejects with an Error whose message is user-ready Finnish.
 */
export async function planAdventure(
  start: LngLat,
  end: LngLat,
  style: AdventureStyle,
  onStage?: (s: LoadStage) => void,
  opts: PlanOptions = {},
): Promise<Adventure> {
  const wander = opts.wander ?? 2;
  const fixed = opts.fixedStops?.length ? opts.fixedStops.map((s) => s.lngLat) : undefined;
  const d = haversine(start, end);
  try {
    let adventure: Adventure | null = null;
    let fallbackPois: Poi[] = [];
    const demo = coversDemo(start, end);
    const travel = opts.travel ?? "walk";
    if (travel === "walk" && ((demo && d <= DEMO_GRAPH_MAX_M) || d <= LIVE_GRAPH_MAX_M)) {
      try {
        const g = await loadGraph(start, end, onStage, opts.signal);
        if (!demo && !g.pois.some((p) => p.id.startsWith("wiki:"))) {
          // Outside the bundled area: add notable places with photos from Wikipedia.
          const wiki = await wikiPois([start, end, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]], d / 2 + 600, opts.signal);
          const before = g.pois.length;
          const merged = mergePois(g.pois, wiki, g.proj);
          for (let i = before; i < merged.length; i++) {
            g.pois.push(merged[i]);
            g.poiGrid.add(merged[i].x, merged[i].y, i);
          }
        }
        fallbackPois = g.pois;
        onStage?.("route");
        // Yield so the loading state can paint before the routing work.
        await new Promise((r) => setTimeout(r, 30));
        adventure = computeAdventure(g, start, end, style, Math.random, wander, fixed);
      } catch (e) {
        // Overpass busy, or no walkable link (islands by ferry) → Valhalla below.
        const recoverable =
          (e instanceof LoadError && !demo) || (e instanceof AdventureError && e.code === "no-path");
        if (!recoverable) throw e;
      }
    }
    if (!adventure) {
      onStage?.("fetch");
      if (travel === "car" && demo && !fallbackPois.length) {
        // Bundled Helsinki places still help a car trip when live searches are slow.
        fallbackPois = (await loadGraph(start, end, undefined, opts.signal).catch(() => null))?.pois ?? [];
      }
      adventure = await computeLongAdventure(start, end, style, wander, opts.signal, fallbackPois, travel, fixed);
      onStage?.("route");
    }
    const stops = await Promise.all(adventure.stops.map(enrichStop));
    // Enrichment can rename stops (English Wikipedia title → Finnish), so tell the story again.
    const story = tellStory(
      style,
      adventure.durationMin,
      adventure.fastMin,
      stops,
      adventure.pois.length,
      adventure.stats.greenShare || undefined,
      adventure.stats.waterMeters,
    );
    return { ...adventure, stops, midstop: stops[0], story };
  } catch (e) {
    if (e instanceof LoadError || e instanceof AdventureError) throw e;
    if (opts.signal?.aborted) throw e;
    console.error(e);
    throw new Error("Jokin meni pieleen retkeä suunnitellessa. Kokeile uudelleen tai valitse eri pisteet.");
  }
}
