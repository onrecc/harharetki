const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export class OverpassError extends Error {}

/**
 * POST a query to Overpass. All mirrors are asked at once and the first good answer wins —
 * public servers are often busy, and waiting for each in turn would leave the user staring at a spinner.
 */
export async function overpass(query: string, signal?: AbortSignal, timeoutMs = 20000): Promise<unknown> {
  const controllers = ENDPOINTS.map(() => new AbortController());
  const abortAll = () => controllers.forEach((c) => c.abort());
  const timer = setTimeout(abortAll, timeoutMs);
  signal?.addEventListener("abort", abortAll);
  try {
    return await Promise.any(
      ENDPOINTS.map(async (url, i) => {
        // Stagger the mirrors slightly so the main server gets the first chance.
        if (i > 0) await new Promise((r) => setTimeout(r, 400 * i));
        if (controllers[i].signal.aborted) throw new Error("aborted");
        const res = await fetch(url, {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          signal: controllers[i].signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { elements?: unknown[] };
        if (!json.elements) throw new Error("virheellinen vastaus");
        controllers.forEach((c, j) => j !== i && c.abort());
        return json;
      }),
    );
  } catch (e) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const errors = e instanceof AggregateError ? e.errors.map((x) => (x as Error).message).join(", ") : String(e);
    throw new OverpassError(errors);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortAll);
  }
}
