import { readFileSync } from "node:fs";
import { buildGraph } from "../src/lib/routing/graph.ts";
import { computeAdventure } from "../src/lib/routing/adventure-core.ts";
const g = buildGraph(JSON.parse(readFileSync("public/data/helsinki.json", "utf8")));
for (const st of ["scenic", "historic", "surprise"] as const) {
  const r = computeAdventure(g, [24.9431, 60.1707], [24.9567, 60.1576], st, Math.random, 4);
  for (const s of r.stops) console.log(st, "|", s.name, "|", s.kind, "|", s.blurb ?? "(ei kuvausta)", "|", s.wikipedia ?? s.wikidata ?? "-");
}
