import type { LngLat } from "./geo.ts";

/** Finnish name first; bilingual "Fi / Sv" names keep their first (Finnish) part. */
export function finnishName(t: Record<string, string | undefined>): string | undefined {
  const n = t["name:fi"] ?? t.name;
  return n?.includes(" / ") ? n.split(" / ")[0].trim() : n;
}

export type PoiCat = "history" | "nature" | "art" | "curio" | "culture";

export interface Poi {
  id: string;
  cat: PoiCat;
  name?: string;
  /** Finnish category label, e.g. "Patsas". */
  kind: string;
  lngLat: LngLat;
  /** How surprising the place is — higher means rarer and more interesting. */
  score: number;
  /** How well-known the place is (Wikipedia, translated names, heritage…), roughly 0–8. */
  popularity: number;
  x: number;
  y: number;
  wikipedia?: string;
  description?: string;
  /** Inscription, artist or construction year — a one-line bit of trivia. */
  detail?: string;
  /** Photo URL when the source provides one (OSM image tag, Wikipedia thumbnail). */
  image?: string;
  /** Wikidata item id, e.g. "Q754507". */
  wikidata?: string;
}

const MATERIAL: Record<string, string> = {
  bronze: "pronssi",
  granite: "graniitti",
  stone: "kivi",
  marble: "marmori",
  steel: "teräs",
  wood: "puu",
  concrete: "betoni",
  brick: "tiili",
  metal: "metalli",
  glass: "lasi",
};

type Rule = [test: (t: Record<string, string>) => boolean, kind: string, score: number, cat: PoiCat];

const ARTWORK: Record<string, string> = {
  statue: "Patsas",
  sculpture: "Veistos",
  mural: "Muraali",
  bust: "Rintakuva",
  installation: "Installaatio",
  relief: "Reliefi",
  graffiti: "Graffiti",
  fountain: "Taidesuihkulähde",
  mosaic: "Mosaiikki",
  stone: "Kiviteos",
};

const HISTORIC: Record<string, [string, number]> = {
  memorial: ["Muistomerkki", 2.2],
  monument: ["Monumentti", 3],
  plaque: ["Muistolaatta", 1.6],
  building: ["Historiallinen rakennus", 2],
  ruins: ["Rauniot", 4],
  fort: ["Linnoitus", 4],
  castle: ["Linna", 4],
  cannon: ["Tykki", 4],
  boundary_stone: ["Rajakivi", 4.5],
  milestone: ["Virstanpylväs", 4.5],
  ship: ["Historiallinen laiva", 4.5],
  wreck: ["Hylky", 5],
  archaeological_site: ["Muinaisjäännös", 4.5],
  manor: ["Kartano", 3],
  church: ["Vanha kirkko", 2.5],
  wayside_cross: ["Tienvarsiristi", 3.5],
  stone: ["Historiallinen kivi", 4],
  tomb: ["Hauta", 4],
  bunker: ["Bunkkeri", 4.5],
  battery: ["Tykkipatteri", 4.5],
  city_gate: ["Kaupunginportti", 4],
  district: ["Historiallinen alue", 1],
};

const RULES: Rule[] = [
  [(t) => t.tourism === "viewpoint", "Näköalapaikka", 4, "nature"],
  [(t) => t.man_made === "lighthouse", "Majakka", 4.5, "curio"],
  [(t) => t.man_made === "windmill", "Tuulimylly", 4.5, "curio"],
  [(t) => t.man_made === "observatory", "Observatorio", 4.5, "curio"],
  [(t) => t.man_made === "obelisk", "Obeliski", 4, "history"],
  [(t) => t.man_made === "water_tower", "Vesitorni", 3.5, "curio"],
  [(t) => t.man_made === "tower", "Torni", 3, "curio"],
  [(t) => t.man_made === "crane", "Nosturi", 3.5, "curio"],
  [(t) => t.man_made === "bridge", "Silta", 2.5, "curio"],
  [(t) => t.natural === "tree", "Merkittävä puu", 4.5, "nature"],
  [(t) => t.natural === "stone" || t.natural === "rock", "Siirtolohkare", 4.5, "nature"],
  [(t) => t.natural === "spring", "Lähde", 4.5, "nature"],
  [(t) => t.natural === "cliff", "Kallio", 3.5, "nature"],
  [(t) => t.natural === "peak", "Kukkula", 3.5, "nature"],
  [(t) => t.natural === "cave_entrance", "Luola", 5, "nature"],
  [(t) => t.natural === "beach", "Ranta", 3, "nature"],
  [(t) => t.leisure === "bird_hide", "Lintutorni", 4.5, "nature"],
  [(t) => t.amenity === "sauna" || t.leisure === "sauna", "Sauna", 3.5, "curio"],
  [(t) => t.amenity === "clock", "Kello", 3.5, "curio"],
  [(t) => t.amenity === "fountain", "Suihkulähde", 3, "art"],
  [(t) => t.tourism === "attraction", "Nähtävyys", 2.5, "curio"],
  [(t) => t.tourism === "museum", "Museo", 2, "culture"],
  [(t) => t.tourism === "gallery", "Galleria", 2, "art"],
  [(t) => t.amenity === "theatre", "Teatteri", 1.5, "culture"],
  [(t) => t.amenity === "library", "Kirjasto", 1.5, "culture"],
  [(t) => t.amenity === "place_of_worship", "Kirkko", 1.5, "history"],
  [(t) => t.leisure === "garden", "Puutarha", 2.5, "nature"],
  [(t) => t.leisure === "park", "Puisto", 1, "nature"],
];

export function classifyPoi(
  type: string,
  id: number,
  t: Record<string, string>,
  lngLat: LngLat,
): Poi | null {
  let kind: string | undefined;
  let score = 0;
  let cat: PoiCat = "curio";

  if (t.tourism === "artwork") {
    kind = ARTWORK[t.artwork_type ?? ""] ?? "Taideteos";
    score = 3.2;
    cat = "art";
  } else if (t.historic && HISTORIC[t.historic]) {
    [kind, score] = HISTORIC[t.historic];
    cat = "history";
  } else if (t.historic && t.historic !== "yes" && t.historic !== "no") {
    kind = "Historiallinen kohde";
    score = 2.5;
    cat = "history";
  } else if (t.memorial) {
    kind = "Muistomerkki";
    score = 2;
    cat = "history";
  } else {
    for (const [test, k, s, c] of RULES)
      if (test(t)) {
        kind = k;
        score = s;
        cat = c;
        break;
      }
  }
  if (!kind) return null;

  const name = finnishName(t);
  // Unnamed things are hard to find and to tell about — keep only the inherently curious ones.
  if (!name && score < 3) return null;
  if (name) score += 0.6;
  if (t.wikipedia || t.wikidata) score += 1;
  if (t.inscription || t.artist_name || t.start_date) score += 0.4;

  // Real facts from the tags — never filler text.
  const year = t.start_date?.match(/(1[0-9]{3}|20[0-2][0-9])/)?.[1];
  const facts = [
    t.artist_name && `Tekijä: ${t.artist_name}`,
    t.architect && `Arkkitehti: ${t.architect}`,
    year && `Vuodelta ${year}`,
    t.material && MATERIAL[t.material] && `Materiaali: ${MATERIAL[t.material]}`,
    t.inscription && `Kaiverrus: ”${t.inscription.slice(0, 140)}”`,
  ].filter(Boolean);
  const joined = facts.join(" · ");
  const detail = facts.length ? (/[.!?”]$/.test(joined) ? joined : `${joined}.`) : undefined;

  // Famous places get translated names, Wikipedia links, photos and lots of detail in OSM.
  const translations = Object.keys(t).filter((k) => /^name:[a-z]{2,3}$/.test(k)).length;
  const popularity =
    (t.wikipedia ? 2 : 0) +
    (t.wikidata ? 1 : 0) +
    Math.min(translations, 8) * 0.35 +
    (t.tourism === "attraction" ? 1 : 0) +
    (t.heritage ? 0.8 : 0) +
    (t.wikimedia_commons || t.image ? 0.5 : 0) +
    Math.min(Object.keys(t).length, 30) / 15;

  return {
    id: `${type}/${id}`,
    popularity,
    cat,
    name,
    kind,
    lngLat,
    score,
    x: 0,
    y: 0,
    wikipedia: t.wikipedia,
    wikidata: /^Q\d+$/.test(t.wikidata ?? "") ? t.wikidata : undefined,
    description: t["description:fi"] ?? t.description,
    detail,
    image: /^https:\/\//.test(t.image ?? "") ? t.image : undefined,
  };
}
