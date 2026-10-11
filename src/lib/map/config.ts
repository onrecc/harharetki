import type { StyleSpecification } from "maplibre-gl";

/** Helsinki city centre — default starting view. [lng, lat] */
export const DEFAULT_CENTER: [number, number] = [24.945, 60.168];
export const DEFAULT_ZOOM = 14;

/** OpenFreeMap vector style (muted Positron) — OSM data, free, no API key, has glyphs. */
export const VECTOR_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Fallback: plain OpenStreetMap raster tiles. */
export const RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/** Muted Baltic base: warm land, soft green parks, teal-blue water, subtle labels. */
const BALTIC_PAINT: Record<string, Record<string, unknown>> = {
  background: { "background-color": "#f6f2ea" },
  park: { "fill-color": "#dde8d3" },
  landcover_wood: { "fill-color": "#d3e2c9" },
  landuse_residential: { "fill-color": "#f0ebe2" },
  water: { "fill-color": "#9fc2cf" },
  waterway: { "line-color": "#8fb8c7" },
  building: { "fill-color": "#e8e1d5", "fill-outline-color": "#dcd3c4" },
  road_area_pier: { "fill-color": "#f6f2ea" },
  road_pier: { "line-color": "#f6f2ea" },
  water_name_point_label: { "text-color": "#2c5a6e", "text-halo-color": "rgba(246,242,234,0.8)" },
  water_name_line_label: { "text-color": "#2c5a6e", "text-halo-color": "rgba(246,242,234,0.8)" },
};

const SUBTLE_LABEL = { "text-color": "#6b7178", "text-halo-color": "#f6f2ea" };

/** Recolours the OpenFreeMap Positron style into the Baltic palette, with Finnish labels first. */
export function balticStyle(input: StyleSpecification): StyleSpecification {
  // Finnish names first, then the local name. (In bilingual areas `name` can be the Swedish one.)
  const finnish = ["coalesce", ["get", "name:fi"], ["get", "name:latin"], ["get", "name"]];
  return {
    ...input,
    layers: input.layers.map((layer) => {
      let out = layer;
      const isShield = layer.id.startsWith("highway-shield") || layer.id.startsWith("road_shield");
      const override = BALTIC_PAINT[layer.id] ?? (layer.type === "symbol" && !isShield ? SUBTLE_LABEL : undefined);
      if (override) out = { ...out, paint: { ...out.paint, ...override } } as typeof layer;
      if (out.type === "symbol" && !isShield && JSON.stringify(out.layout?.["text-field"] ?? "").includes("name")) {
        out = { ...out, layout: { ...out.layout, "text-field": finnish } } as typeof layer;
      }
      return out;
    }),
  };
}
