import { readFileSync } from "node:fs";
import { buildGraph } from "../src/lib/routing/graph.ts";
import { computeAdventure, type Wander } from "../src/lib/routing/adventure-core.ts";
const g = buildGraph(JSON.parse(readFileSync("public/data/helsinki.json", "utf8")));
const a: [number, number] = [24.9535, 60.1712], b: [number, number] = [24.9560, 60.1640]; // Vuorikatu -> Laivasillankatu-ish
for (const st of ["scenic", "historic", "surprise"] as const) for (const w of [1, 2, 3, 4, 5, 11] as Wander[]) {
  const counts = [], mins = [];
  for (let i = 0; i < 5; i++) { const r = computeAdventure(g, a, b, st, Math.random, w); counts.push(r.stops.length); mins.push(r.durationMin + "/" + r.fastMin); }
  console.log(st, "w" + w, "stops", counts.join(","), "min", mins.join(" "));
}
