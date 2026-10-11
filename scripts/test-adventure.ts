import { readFileSync } from "node:fs";
import { buildGraph } from "../src/lib/routing/graph.ts";
import { computeAdventure, type Wander } from "../src/lib/routing/adventure-core.ts";
const g = buildGraph(JSON.parse(readFileSync("public/data/helsinki.json", "utf8")));
const pairs: [number, number][][] = [
  [[24.9431, 60.1707], [24.9567, 60.1576]],
  [[24.9316, 60.1688], [24.9655, 60.1736]],
];
for (const [a, b] of pairs) for (const st of ["scenic", "historic", "surprise"] as const) for (const w of [1, 2, 3, 5, 11] as Wander[]) {
  const t = Date.now();
  const r = computeAdventure(g, a, b, st, Math.random, w);
  console.log(`${st} w${w} ${Date.now() - t}ms ${r.distanceM}m ${r.durationMin}/${r.fastMin}min stops=${r.stops.length} | ${r.stops.map(s => s.name).join(" / ").slice(0, 110)}`);
}
console.log(computeAdventure(g, pairs[0][0], pairs[0][1], "historic", Math.random, 3).story);
