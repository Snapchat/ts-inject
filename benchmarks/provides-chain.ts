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

function buildChain(n: number): Container<Record<string, number>> {
  let c: Container<any> = new Container({});
  for (let i = 0; i < n; i++) {
    c = c.provides(`svc${i}`, () => i);
  }
  return c;
}

function timeMs(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6;
}

function bench(n: number, iters: number): number {
  buildChain(n); // warmup
  return timeMs(() => {
    for (let i = 0; i < iters; i++) buildChain(n);
  }) / iters;
}

const sizes = [50, 100, 200, 400, 800, 1600, 3200, 8000];
// More iterations for the cheap cases so we get a stable signal; fewer for the expensive ones
// so the suite finishes in seconds rather than minutes.
const itersFor = (n: number): number =>
  n <= 200 ? 50 : n <= 400 ? 20 : n <= 800 ? 5 : n <= 3200 ? 3 : 2;

console.log("Chain construction:");
console.log("size\tms/build");
for (const n of sizes) {
  const ms = bench(n, itersFor(n));
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
console.log(`\nFull get-pass on ${lookupChainSize}-deep chain: ${lookupMs.toFixed(2)} ms/iter`);
