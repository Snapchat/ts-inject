/**
 * Eager-versus-lazy class registration benchmark.
 *
 * The simulated-loader case models a cache-on-first-read module namespace: each export starts with an unevaluated
 * initializer, and the Proxy evaluates and caches that export's class on its first read. The already-loaded case uses
 * ordinary array access so it measures portable wrapper/caching overhead without attributing native ESM module
 * evaluation to the thunk.
 */

import { Container } from "../src/Container";
import type { InjectableClass, TokenType } from "../src/types";

interface ChainService {
  readonly index: number;
  readonly previous?: ChainService;
}

type ChainClass = InjectableClass<any, ChainService, readonly TokenType[]>;
type RegistrationMode = "eager" | "lazy";

interface LazyExportLoader {
  readonly exports: Record<string, ChainClass>;
  reads(): number;
  evaluations(): number;
}

interface Metrics {
  readonly registrationMs: number;
  readonly registrationReads: number;
  readonly registrationEvaluations: number;
  readonly firstResolutionMs: number;
  readonly allResolutionMs: number;
  readonly hotGetNs: number;
}

const SIZES = [10, 100, 1000];
const WARMUP_SAMPLES = 5;
const SAMPLES = 15;
const HOT_GETS = 100_000;

let benchmarkSink: unknown;

function serviceToken(index: number): string {
  return `service${index}`;
}

function createClass(index: number): ChainClass {
  const dependencies = index === 0 ? ([] as const) : ([serviceToken(index - 1)] as const);
  class Service implements ChainService {
    static dependencies = dependencies;
    readonly index = index;

    constructor(readonly previous?: ChainService) {}
  }
  return Service as ChainClass;
}

function createClasses(size: number): ChainClass[] {
  const classes: ChainClass[] = [];
  for (let index = 0; index < size; index++) classes.push(createClass(index));
  return classes;
}

function createLazyExportLoader(size: number): LazyExportLoader {
  let reads = 0;
  let evaluations = 0;
  const initializers = Object.create(null) as Record<string, () => ChainClass>;
  const cache = Object.create(null) as Record<string, ChainClass>;
  for (let index = 0; index < size; index++) {
    initializers[serviceToken(index)] = () => createClass(index);
  }
  const exports = new Proxy(Object.create(null) as Record<string, ChainClass>, {
    get(_target, property) {
      reads += 1;
      if (typeof property !== "string" || !Object.prototype.hasOwnProperty.call(initializers, property)) {
        return undefined;
      }
      if (!Object.prototype.hasOwnProperty.call(cache, property)) {
        cache[property] = initializers[property]();
        evaluations += 1;
      }
      return cache[property];
    },
  });
  return { exports, reads: () => reads, evaluations: () => evaluations };
}

function buildLoaderContainer(
  loader: LazyExportLoader,
  size: number,
  mode: RegistrationMode
): Container<Record<string, ChainService>> {
  let container: Container<any> = new Container({});
  for (let index = 0; index < size; index++) {
    const token = serviceToken(index);
    container =
      mode === "eager"
        ? container.providesClass(token, loader.exports[token] as any)
        : container.providesClass(token, () => loader.exports[token] as any);
  }
  return container;
}

function buildLoadedContainer(
  classes: readonly ChainClass[],
  mode: RegistrationMode
): Container<Record<string, ChainService>> {
  let container: Container<any> = new Container({});
  for (let index = 0; index < classes.length; index++) {
    const token = serviceToken(index);
    container =
      mode === "eager"
        ? container.providesClass(token, classes[index] as any)
        : container.providesClass(token, () => classes[index] as any);
  }
  return container;
}

function resolveAll(container: Container<Record<string, ChainService>>, size: number): ChainService {
  let service: ChainService = container.get(serviceToken(0));
  for (let index = 1; index < size; index++) service = container.get(serviceToken(index));
  return service;
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function elapsedMs(run: () => void): number {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function runSamples(runSample: () => number): number {
  for (let index = 0; index < WARMUP_SAMPLES; index++) runSample();
  const samples: number[] = [];
  for (let index = 0; index < SAMPLES; index++) samples.push(runSample());
  return median(samples);
}

function benchmarkOperation(run: () => unknown, iterations: number): number {
  return runSamples(
    () =>
      elapsedMs(() => {
        for (let iteration = 0; iteration < iterations; iteration++) benchmarkSink = run();
      }) / iterations
  );
}

function benchmarkWithSetup<T>(setup: () => T, run: (value: T) => unknown, iterations: number): number {
  return runSamples(() => {
    const values: T[] = [];
    for (let iteration = 0; iteration < iterations; iteration++) values.push(setup());
    return (
      elapsedMs(() => {
        for (const value of values) benchmarkSink = run(value);
      }) / iterations
    );
  });
}

function registrationIterations(size: number): number {
  return size === 10 ? 500 : size === 100 ? 100 : 10;
}

function resolutionIterations(size: number): number {
  // At 1,000 services, retaining several fresh containers in the setup batch creates enough garbage to make the
  // timed resolution window depend on when V8 happens to collect. A single operation is still hundreds of microseconds,
  // so timer resolution is ample; the 15 independent samples provide the stability instead.
  return size === 10 ? 200 : size === 100 ? 40 : 1;
}

function measure(
  size: number,
  registrationMs: number,
  build: () => Container<Record<string, ChainService>>,
  registrationReads: number,
  registrationEvaluations: number
): Metrics {
  const firstResolutionMs = benchmarkWithSetup(
    build,
    (container) => container.get(serviceToken(0)),
    resolutionIterations(size)
  );
  const allResolutionMs = benchmarkWithSetup(
    build,
    (container) => resolveAll(container, size),
    resolutionIterations(size)
  );
  const hotBatchMs = benchmarkWithSetup(
    () => {
      const container = build();
      resolveAll(container, size);
      return container;
    },
    (container) => {
      const token = serviceToken(size - 1);
      for (let iteration = 0; iteration < HOT_GETS; iteration++) benchmarkSink = container.get(token);
      return benchmarkSink;
    },
    1
  );

  return {
    registrationMs,
    registrationReads,
    registrationEvaluations,
    firstResolutionMs,
    allResolutionMs,
    hotGetNs: (hotBatchMs * 1e6) / HOT_GETS,
  };
}

function loaderMetrics(size: number, mode: RegistrationMode): Metrics {
  const registrationMs = benchmarkWithSetup(
    () => createLazyExportLoader(size),
    (loader) => buildLoaderContainer(loader, size, mode),
    registrationIterations(size)
  );
  const probe = createLazyExportLoader(size);
  buildLoaderContainer(probe, size, mode);
  const build = () => buildLoaderContainer(createLazyExportLoader(size), size, mode);
  return measure(size, registrationMs, build, probe.reads(), probe.evaluations());
}

function loadedMetrics(classes: readonly ChainClass[], mode: RegistrationMode): Metrics {
  const build = () => buildLoadedContainer(classes, mode);
  const registrationMs = benchmarkOperation(build, registrationIterations(classes.length));
  return measure(classes.length, registrationMs, build, 0, 0);
}

function printTable(
  title: string,
  rows: Array<{ size: number; eager: Metrics; lazy: Metrics }>,
  includeLoaderStats: boolean
): void {
  console.log(`\n${title}`);
  const loaderHeader = includeLoaderStats ? "\teager reads\tlazy reads\teager evaluations\tlazy evaluations" : "";
  console.log(
    `size\teager reg ms\tlazy reg ms${loaderHeader}\teager first ms\tlazy first ms` +
      "\teager all ms\tlazy all ms\teager hot ns/get\tlazy hot ns/get"
  );
  for (const { size, eager, lazy } of rows) {
    const loaderStats = includeLoaderStats
      ? `\t${eager.registrationReads}\t${lazy.registrationReads}` +
        `\t${eager.registrationEvaluations}\t${lazy.registrationEvaluations}`
      : "";
    console.log(
      `${size}\t${eager.registrationMs.toFixed(4)}\t${lazy.registrationMs.toFixed(4)}${loaderStats}` +
        `\t${eager.firstResolutionMs.toFixed(4)}\t${lazy.firstResolutionMs.toFixed(4)}` +
        `\t${eager.allResolutionMs.toFixed(4)}\t${lazy.allResolutionMs.toFixed(4)}` +
        `\t${eager.hotGetNs.toFixed(1)}\t${lazy.hotGetNs.toFixed(1)}`
    );
  }
}

console.log("\nLazy class registration benchmark:");
console.log(
  `${SAMPLES} measured samples after ${WARMUP_SAMPLES} warmup samples; reported values are medians. ` +
    "Registration and resolution use fresh containers. First resolution gets service0; all resolution gets every " +
    `service in dependency order; hot get resolves all services before ${HOT_GETS.toLocaleString()} repeated tail gets.`
);
console.log(
  "Each simulated export has its own loader record. Loader creation is outside timed registration; first export read " +
    "evaluates and caches the class initializer."
);

const loaderRows: Array<{ size: number; eager: Metrics; lazy: Metrics }> = [];
const loadedRows: Array<{ size: number; eager: Metrics; lazy: Metrics }> = [];
for (const size of SIZES) {
  loaderRows.push({ size, eager: loaderMetrics(size, "eager"), lazy: loaderMetrics(size, "lazy") });
  const classes = createClasses(size);
  loadedRows.push({ size, eager: loadedMetrics(classes, "eager"), lazy: loadedMetrics(classes, "lazy") });
}

printTable("Simulated lazy export loader (cold modules)", loaderRows, true);
printTable("Already-loaded classes", loadedRows, false);

// Keep the sink observable so an optimizing runtime cannot prove all benchmark work dead.
if (benchmarkSink === Symbol.for("ts-inject-benchmark-impossible")) console.log(benchmarkSink);
