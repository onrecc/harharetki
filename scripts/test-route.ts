import { readFileSync } from "node:fs";
import { buildGraph } from "../src/lib/routing/graph.ts";
import { planRoutes } from "../src/lib/routing/route.ts";
let t = Date.now();
const data = JSON.parse(readFileSync("public/data/helsinki.json", "utf8"));
console.log("parse", Date.now() - t); t = Date.now();
const g = buildGraph(data);
console.log("graph", Date.now() - t, "nodes", g.nx.length, "edges", g.edgeLen.length, "pois", g.pois.length,
  "green edges", g.edgeGreen.reduce((a, b) => a + b, 0), "water edges", g.edgeWater.reduce((a, b) => a + b, 0)); t = Date.now();
const pairs: [number, number][][] = [
  [[24.9414, 60.1710], [24.9530, 60.1585]],
  [[24.9300, 60.1640], [24.9600, 60.1700]],
];
for (const [a, b] of pairs) {
  t = Date.now();
  const r = planRoutes(g, a, b);
  console.log("plan", Date.now() - t, "ms");
  for (const x of r.routes) console.log(x.id, Math.round(x.stats.length), "m", x.extraMinutes.toFixed(1), "min |", x.story, "|", x.highlights.join(" · "), "| pois:", x.pois.slice(0, 6).map(p => `${p.kind}:${p.name ?? "-"}`).join(", "));
}
