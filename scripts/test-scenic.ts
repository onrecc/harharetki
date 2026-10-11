import { readFileSync } from "node:fs";
import { buildGraph } from "../src/lib/routing/graph.ts";
import { computeAdventure, type Wander } from "../src/lib/routing/adventure-core.ts";
const g = buildGraph(JSON.parse(readFileSync("public/data/helsinki.json", "utf8")));
// Töölö -> Katajanokka (reviewer's case)
const a: [number, number] = [24.9220, 60.1800], b: [number, number] = [24.9660, 60.1675];
for (const w of [1, 2, 3, 5] as Wander[]) {
  const r = computeAdventure(g, a, b, "scenic", Math.random, w);
  console.log("scenic w" + w, r.distanceM, "m", r.durationMin + "/" + r.fastMin, "min |", r.story);
}
const r4 = computeAdventure(g, [24.9316, 60.1688], [24.9655, 60.1736], "historic", Math.random, 5);
console.log(r4.story);
