import { performance } from "node:perf_hooks";
import { indexInventory } from "../scripts/containers.js";
import { FakeActor, raw } from "./fixtures.mjs";

for (const count of [100, 1000, 10000]) {
  const data = [raw("bag", "gear", null, true)];
  for (let i = 1; i < count; i++) data.push(raw(`item${i}`, ["weapon", "ammo", "armor"][i % 3], "bag"));
  const actor = new FakeActor(`bench${count}`, data);
  for (let i = 0; i < 10; i++) indexInventory(actor.items);
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    indexInventory(actor.items);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ items: count, medianMs: +samples[50].toFixed(3), p95Ms: +samples[95].toFixed(3) }));
}
