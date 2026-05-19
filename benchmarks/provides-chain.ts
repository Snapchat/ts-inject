/**
 * Microbenchmark for `Container.provides()` chain construction and `Container.get()` lookups.
 *
 * Run with:
 *   npm run bench
 *
 * Designed to verify the per-step cost of `provides()` stays roughly linear in chain length
 * (it was previously O(N²) — see docs/perf-provides-chain.md). Adjust `sizes` and `iters`
 * if you want to exercise different regimes.
 */

import { Container } from "../src/Container";
import { PartialContainer } from "../src/PartialContainer";

function buildChain(n: number): Container<Record<string, number>> {
  let c: Container<any> = new Container({});
  for (let i = 0; i < n; i++) {
    c = c.provides(`svc${i}`, () => i);
  }
  return c;
}

function buildPartialChain(n: number): PartialContainer<any, any> {
  let p: PartialContainer<any, any> = new PartialContainer({});
  for (let i = 0; i < n; i++) {
    p = p.provides(`svc${i}`, () => i);
  }
  return p;
}

function timeMs(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6;
}

function bench(build: (n: number) => unknown, n: number, iters: number): number {
  build(n); // warmup
  return (
    timeMs(() => {
      for (let i = 0; i < iters; i++) build(n);
    }) / iters
  );
}

const sizes = [50, 100, 200, 400, 800, 1600, 3200, 8000];
// More iterations for the cheap cases so we get a stable signal; fewer for the expensive ones
// so the suite finishes in seconds rather than minutes.
const itersFor = (n: number): number => (n <= 200 ? 50 : n <= 400 ? 20 : n <= 800 ? 5 : n <= 3200 ? 3 : 2);

console.log("Container chain construction:");
console.log("size\tms/build");
for (const n of sizes) {
  const ms = bench(buildChain, n, itersFor(n));
  console.log(`${n}\t${ms.toFixed(2)}`);
}

console.log("\nPartialContainer chain construction:");
console.log("size\tms/build");
for (const n of sizes) {
  const ms = bench(buildPartialChain, n, itersFor(n));
  console.log(`${n}\t${ms.toFixed(2)}`);
}

// Lookup-cost probe: services added later in the chain are shallow in the prototype chain,
// services added earlier are deep. A full pass exercises a range of depths.
const lookupChainSize = 800;
const lookupIters = 50;
const c = buildChain(lookupChainSize);
const lookupMs =
  timeMs(() => {
    for (let i = 0; i < lookupIters; i++) {
      for (let k = 0; k < lookupChainSize; k++) c.get(`svc${k}`);
    }
  }) / lookupIters;
console.log(`\nFull get-pass on ${lookupChainSize}-deep Container chain: ${lookupMs.toFixed(2)} ms/iter`);

// Materialization probe: hand a PartialContainer of size N to a Container and time the merge.
// This exercises PartialContainer.getFactories + Container.provides(partial).
console.log("\nMaterialize PartialContainer into Container (`Container.provides(partial)`):");
console.log("size\tms/materialize");
for (const n of sizes) {
  const partial = buildPartialChain(n);
  const iters = itersFor(n);
  Container.provides(partial); // warmup
  const ms =
    timeMs(() => {
      for (let i = 0; i < iters; i++) Container.provides(partial);
    }) / iters;
  console.log(`${n}\t${ms.toFixed(2)}`);
}
