/**
 * Microbenchmark for `Container.get()` cost across chain depth.
 *
 * Run with:
 *   npm run bench:get
 *
 * Designed to confirm that resolving a service is O(1) regardless of where it
 * sits in the prototype-chained factories map. Without the read-path flatten,
 * `factories[token]` is a chain walk costing O(depth), so a full get-pass over
 * an N-deep chain is O(N²). With the flatten cache, the first `get` pays one
 * O(N) walk and all subsequent gets are O(1), so the full sweep is O(N).
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

const sizes = [50, 100, 200, 400, 800, 1600];
// Cheap sizes need many iterations for a stable signal; expensive ones need fewer
// to keep the suite finishing in seconds.
const itersFor = (n: number): number => (n <= 100 ? 200 : n <= 400 ? 50 : n <= 800 ? 20 : 10);

// Build a fresh container per iteration so we measure cold + warm gets together.
// (A single container would amortize the flatten over warm reads only, hiding the
// first-call cost. Real workloads typically resolve each service a handful of times.)
console.log("Full get-pass per iteration (build container + resolve every service once):");
console.log("size\tms/iter");
for (const n of sizes) {
  const iters = itersFor(n);
  // warmup
  {
    const c = buildChain(n);
    for (let k = 0; k < n; k++) c.get(`svc${k}`);
  }
  const ms =
    timeMs(() => {
      for (let i = 0; i < iters; i++) {
        const c = buildChain(n);
        for (let k = 0; k < n; k++) c.get(`svc${k}`);
      }
    }) / iters;
  console.log(`${n}\t${ms.toFixed(2)}`);
}

// Hot read path: a single container, repeated full passes. The first pass pays
// any one-time setup (e.g. lazy flatten); subsequent passes hit memoized factories
// and should be uniformly cheap. If `get` is O(1), per-iter time stays linear in N.
console.log("\nHot read path per iteration (same container, repeated full sweep):");
console.log("size\tms/iter");
for (const n of sizes) {
  const iters = 500;
  const c = buildChain(n);
  // warmup — triggers flatten (if any) and primes V8 inline caches.
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < n; k++) c.get(`svc${k}`);
  }
  const ms =
    timeMs(() => {
      for (let i = 0; i < iters; i++) {
        for (let k = 0; k < n; k++) c.get(`svc${k}`);
      }
    }) / iters;
  console.log(`${n}\t${ms.toFixed(3)}`);
}
