import type { LngLat } from "@/lib/routing/geo";
import type { Poi, PoiCat } from "@/lib/routing/poi";

/**
 * Worldwide points of interest from Wikipedia GeoSearch: notable places with a photo and a
 * popularity signal (how many language versions the article has). Complements Overpass,
 * which is great for small curiosities but often busy.
 */

/** Rough country boxes → local Wikipedia language. Anything else falls back to English. */
const LOCAL_LANG: [lang: string, s: number, w: number, n: number, e: number][] = [
  ["fi", 59.7, 19.0, 70.1, 31.6],
  ["et", 57.5, 21.7, 59.7, 28.2],
  ["sv", 55.3, 11.0, 69.1, 24.2],
  ["no", 57.9, 4.5, 71.2, 31.1],
  ["da", 54.5, 8.0, 57.8, 12.7],
  ["de", 47.3, 5.9, 55.1, 15.0],
  ["nl", 50.7, 3.3, 53.6, 7.2],
  ["fr", 42.3, -4.8, 51.1, 8.2],
  ["es", 36.0, -9.3, 43.8, 3.3],
  ["it", 36.6, 6.6, 47.1, 18.5],
  ["pl", 49.0, 14.1, 54.8, 24.1],
  ["ja", 30.0, 129.5, 45.6, 145.8],
];

/** "Suru (veistos)" → "Suru", "Kolskjulet, Kastellholmen" → "Kolskjulet" (disambiguation suffixes). */
export function cleanTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").replace(/,\s[^,]+$/, "").trim() || title;
}

export function wikiLangs(p: LngLat): string[] {
  const [lng, lat] = p;
  const local = LOCAL_LANG.find(([, s, w, n, e]) => lat >= s && lat <= n && lng >= w && lng <= e)?.[0];
  return local && local !== "en" ? [local, "en"] : ["en"];
}

/** GeoSearch "type"s that are areas rather than places you can walk up to. */
const AREA_TYPES = new Set([
  "country", "satellite", "state", "adm1st", "adm2nd", "adm3rd", "city", "event", "airport", "glacier",
  // Water: a stop in the middle of a bay or lake can't be walked to.
  "waterbody", "river",
]);

// Whole words only — "most" (Polish: bridge) must not match "most populous city".
const w = (words: string) => new RegExp(`(^|[^\\p{L}])(${words})($|[^\\p{L}])`, "iu");
/** [whole-word rule, Finnish compound-suffix rule (e.g. "Pitkäsilta"), kind, category] */
const KIND_RULES: [RegExp, RegExp | null, string, PoiCat][] = [
  [w("cathedral|church|chapel|kirkko|tuomiokirkko|kyrka|kirche|dom|église|cathédrale|iglesia|chiesa|kościół"), /(kirkko|kappeli)$/iu, "Kirkko", "history"],
  [w("museum|museo|museet|musée|muzeum"), /(museo)$/iu, "Museo", "culture"],
  [w("statue|sculpture|patsas|veistos|staty|skulptur|statua"), /(patsas|veistos)$/iu, "Patsas", "art"],
  [w("monument|memorial|muistomerkki|minnesmärke|denkmal|mémorial|pomnik"), /(muistomerkki)$/iu, "Muistomerkki", "history"],
  [w("castle|fortress|linna|linnoitus|slott|schloss|burg|château|castillo|castello|zamek"), /(linnoitus)$/iu, "Linna", "history"],
  [w("palace|palatsi|palast|palais|palacio|palazzo|pałac"), /(palatsi)$/iu, "Palatsi", "history"],
  [w("park|garden|puisto|puutarha|trädgård|garten|jardin|jardín|giardino|ogród"), /(puisto|puutarha)$/iu, "Puisto", "nature"],
  [w("bridge|silta|brücke|pont|puente|ponte"), /(silta)$/iu, "Silta", "curio"],
  [w("lighthouse|majakka|fyr|leuchtturm|phare|faro"), /(majakka)$/iu, "Majakka", "curio"],
  [w("tower|torni|turm|torre|wieża"), /(torni)$/iu, "Torni", "curio"],
  [w("fountain|suihkulähde|fontän|brunnen|fontaine|fuente|fontana"), /(suihkulähde)$/iu, "Suihkulähde", "art"],
  [w("theatre|theater|teatteri|teater|théâtre|teatro"), /(teatteri)$/iu, "Teatteri", "culture"],
  [w("library|kirjasto|bibliotek|bibliothek|bibliothèque|biblioteca"), /(kirjasto)$/iu, "Kirjasto", "culture"],
  [w("square|tori|aukio|torg|platz|plaza|piazza|rynek"), /(aukio)$/iu, "Aukio", "history"],
  [w("building|rakennus|byggnad|gebäude|bâtiment|edificio|house|talo|villa|manor|kartano"), /(rakennus|kartano|talo)$/iu, "Rakennus", "history"],
];

/** Stations and stops are transport, not sights. */
const STATION_WORDS = w(
  "metro station|subway station|underground station|railway station|train station|bus station|tram stop|metroasema|rautatieasema|juna-asema|linja-autoasema|raitiovaunupysäkki|tunnelbanestation|järnvägsstation|u-bahnhof|bahnhof|gare|station de métro",
);

/** Working institutions are not sights: hotels, schools, hospitals, offices, shops. */
const INSTITUTION_WORDS = w(
  "hotel|hostel|motel|hotelli|school|university|college|faculty|law school|koulu|lukio|yliopisto|ammattikorkeakoulu|hospital|clinic|sairaala|terveyskeskus|office|headquarters|toimitalo|pääkonttori|company|yhtiö|shopping centre|shopping center|mall|kauppakeskus|restaurant|ravintola|apartment|condominium|skyscraper|pilvenpiirtäjä|parking|pysäköinti",
);

/** Descriptions of places you can't "visit" as a stop: cities, districts, regions. */
const AREA_WORDS = w(
  "city|capital|town|village|municipality|district|neighbourhood|neighborhood|suburb|quarter|region|province|county|country|kaupunki|pääkaupunki|kunta|kaupunginosa|kylä|maakunta|stad|kommun|stadsdel|stadt|gemeinde|ville|commune|arrondissement|quartier|ciudad|città|comune|vesialue|merialue|selkä|lahti|salmi|järvi|joki|water area|bay|strait|sound|lake|river|fjärd|vik|sund|sjö",
);

export function classify(title: string, description = ""): [string, PoiCat] {
  const text = `${title} ${description}`;
  const words = text.split(/[^\p{L}]+/u);
  for (const [re, suffix, kind, cat] of KIND_RULES)
    if (re.test(text) || (suffix && words.some((x) => suffix.test(x)))) return [kind, cat];
  return ["Nähtävyys", "curio"];
}

interface GeoHit {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  type?: string | null;
  dim?: number | string;
}

interface PageInfo {
  pageid: number;
  title: string;
  description?: string;
  langlinkscount?: number;
  thumbnail?: { source: string };
  pageprops?: { wikibase_item?: string };
}

async function getJson(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchLang(lang: string, centers: LngLat[], radius: number, signal: AbortSignal): Promise<Poi[]> {
  const api = `https://${lang}.wikipedia.org/w/api.php?format=json&origin=*&action=query`;
  const hits = new Map<number, GeoHit>();
  await Promise.all(
    centers.map(async ([lng, lat]) => {
      try {
        const j = await getJson(
          `${api}&list=geosearch&gscoord=${lat}|${lng}&gsradius=${Math.round(Math.min(10000, Math.max(100, radius)))}&gslimit=100&gsprop=type|dim`,
          signal,
        );
        for (const h of (j.query?.geosearch ?? []) as GeoHit[]) {
          if (h.type && AREA_TYPES.has(h.type)) continue;
          if (Number(h.dim) > 2500) continue;
          hits.set(h.pageid, h);
        }
      } catch {
        // One failed sample point just means fewer candidates.
      }
    }),
  );
  if (!hits.size) return [];

  const ids = [...hits.keys()];
  const info = new Map<number, PageInfo>();
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const j = await getJson(
        `${api}&prop=pageimages|description|langlinkscount|pageprops&ppprop=wikibase_item&piprop=thumbnail&pithumbsize=480&pageids=${ids.slice(i, i + 50).join("|")}`,
        signal,
      );
      for (const p of Object.values(j.query?.pages ?? {}) as PageInfo[]) info.set(p.pageid, p);
    } catch {
      // Keep the hits without details.
    }
  }

  return [...hits.values()].flatMap((h) => {
    const p = info.get(h.pageid);
    // Skip cities and districts ("Helsinki", "Kallio") — they are not stops.
    if (p?.description && AREA_WORDS.test(p.description) && classify(h.title)[0] === "Nähtävyys") return [];
    if (STATION_WORDS.test(`${h.title} ${p?.description ?? ""}`) || /asema$/i.test(h.title)) return [];
    // Hotels, schools, hospitals… unless the article calls them historic or a museum.
    if (
      INSTITUTION_WORDS.test(`${h.title} ${p?.description ?? ""}`) &&
      !/museum|museo|historic|historiallinen|heritage|monument/i.test(p?.description ?? "")
    )
      return [];
    const [kind, cat] = classify(h.title, p?.description);
    const langs = p?.langlinkscount ?? 0;
    return {
      id: `wiki:${lang}:${h.pageid}`,
      cat,
      name: cleanTitle(h.title),
      kind,
      lngLat: [h.lon, h.lat] as LngLat,
      // Notable enough for an article; famous ones exist in dozens of languages.
      score: 2.6 + (p?.thumbnail ? 0.4 : 0) + Math.min(langs, 40) / 40,
      popularity: 2 + Math.min(langs * 0.08, 6),
      x: 0,
      y: 0,
      wikipedia: `${lang}:${h.title}`,
      wikidata: p?.pageprops?.wikibase_item,
      description: p?.description,
      image: p?.thumbnail?.source,
    } satisfies Poi;
  });
}

/**
 * Wikipedia places within `radius` m of the given sample points, in the local language plus English.
 * Never throws; resolves to [] on failure. Deduplicates by name and location.
 */
export async function wikiPois(centers: LngLat[], radius: number, signal?: AbortSignal, timeoutMs = 8000): Promise<Poi[]> {
  if (!centers.length) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const langs = wikiLangs(centers[Math.floor(centers.length / 2)]);
    const lists = await Promise.all(langs.map((l) => searchLang(l, centers, radius, ctrl.signal).catch(() => [])));
    const out: Poi[] = [];
    for (const p of lists.flat()) {
      const dup = out.some(
        (q) =>
          // Same Wikidata item in another language (fi is searched first, so it wins)…
          (!!p.wikidata && q.wikidata === p.wikidata) ||
          // …or the same thing right next to it.
          (Math.abs(q.lngLat[0] - p.lngLat[0]) < 0.0012 &&
            Math.abs(q.lngLat[1] - p.lngLat[1]) < 0.0008 &&
            (q.name === p.name || q.kind === p.kind)),
      );
      if (!dup) out.push(p);
    }
    return out;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Sample points along a line, every `spacing` metres (at least start and end). */
export function samplePoints(coords: LngLat[], spacing: number, max = 8): LngLat[] {
  if (coords.length === 0) return [];
  const out: LngLat[] = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    acc += Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110574);
    if (acc >= spacing) {
      out.push(b);
      acc = 0;
    }
  }
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  if (out.length <= max) return out;
  const step = (out.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => out[Math.round(i * step)]);
}
