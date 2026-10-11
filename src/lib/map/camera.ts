import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import type { LngLat, MapPadding } from "./types";

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Frame `bounds` inside the visible area. MapLibre keeps the padding of earlier camera moves and
 * adds it to the new one, so stale padding (e.g. from centring on a stop) could double it — the fit
 * then silently fails on phones or zooms out far too much. Always start from zero.
 */
export function frameBounds(
  map: MapLibreMap,
  bounds: LngLatBoundsLike,
  padding: MapPadding,
  opts: { maxZoom?: number; duration?: number } = {},
) {
  map.setPadding(ZERO);
  map.fitBounds(bounds, { padding, ...opts });
}

/** Centre `p` in the visible area via a one-off offset, leaving the map's own padding untouched. */
export function centerOn(
  map: MapLibreMap,
  p: LngLat,
  padding: MapPadding,
  opts: { zoom?: number; duration?: number; bearing?: number; pitch?: number } = {},
) {
  map.setPadding(ZERO);
  map.easeTo({
    center: p,
    offset: [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2],
    ...opts,
  });
}
