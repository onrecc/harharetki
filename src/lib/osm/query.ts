export type BBox = [south: number, west: number, north: number, east: number];

const WALKABLE =
  "footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|cycleway|corridor|bridleway|road";

/** OSM selectors for curious places worth a detour. */
export const POI_SELECTORS = [
  `nwr[historic][historic!~"^(no|yes)$"]`,
  `nwr[tourism~"^(artwork|viewpoint|attraction|museum|gallery)$"]`,
  `nwr[amenity~"^(fountain|clock|place_of_worship|library|theatre|sauna)$"]`,
  `nwr[man_made~"^(lighthouse|tower|water_tower|windmill|obelisk|observatory|crane|bridge)$"][name]`,
  `nwr[leisure~"^(park|garden|bird_hide|sauna)$"][name]`,
  `nwr[natural~"^(tree|rock|stone|peak|cliff|spring|cave_entrance|beach)$"][name]`,
  `node[natural=tree][denotation~"^(natural_monument|landmark)$"]`,
  `nwr[memorial]`,
];

/** One Overpass request that returns the walkable street graph, green/blue areas and points of interest. */
export function buildQuery(bbox: BBox, timeout = 60): string {
  return `[out:json][timeout:${timeout}][bbox:${bbox.join(",")}];
way[highway~"^(${WALKABLE})$"][area!=yes][access!~"^(private|no)$"][foot!~"^(no|private)$"]->.r;
.r out body qt;
node(w.r);out skel qt;
(
  way[leisure~"^(park|garden|nature_reserve|playground|dog_park)$"];
  way[landuse~"^(grass|forest|meadow|recreation_ground|cemetery|allotments|village_green|orchard)$"];
  way[natural~"^(wood|scrub|grassland|heath|beach|water|wetland|bare_rock)$"];
  way[natural=coastline];
  way[waterway~"^(river|stream|canal)$"];
)->.g;
.g out geom qt;
(
${POI_SELECTORS.map((x) => `  ${x};`).join("\n")}
);
out center tags qt;`;
}

/** Points of interest within `radius` metres of a polyline given as "lat,lon,lat,lon,…". */
export function buildPoiCorridorQuery(line: string, radius: number, timeout = 40): string {
  const around = `(around:${Math.round(radius)},${line})`;
  return `[out:json][timeout:${timeout}];
(
${POI_SELECTORS.map((x) => `  ${x}${around};`).join("\n")}
);
out center tags qt;`;
}
