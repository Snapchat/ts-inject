# Lazy class registration benchmark

Measured on 2026-08-21 with Node.js 22.22.1 on an Apple M4 Max (128 GiB), macOS 26.5.2. Times are local
microbenchmark results, not device or production lazy-loader measurements.

## Method

Run the complete harness with:

```bash
npm ci
npm run bench
```

The benchmark builds linear class chains of 10, 100, and 1,000 services; service _i_ depends on service _i - 1_. It
reports the median of 15 measured samples after 5 warmup samples. Registration samples use 500, 100, and 10 builds
respectively. Cold resolution samples use 200, 40, and 1 fresh containers respectively; using one container at 1,000
avoids making the timed window depend on garbage collection of a retained setup batch. Steady-state samples resolve
all services first and then perform 100,000 repeated `get()` calls for the tail service.

“First” resolves only `service0` from a fresh, fully registered container. “All” resolves every service in dependency
order from a fresh container. Registration/container construction is outside both resolution timings.

The simulated loader gives every service its own unevaluated export initializer. Creating loader records is outside the
timed registration window. On the first Proxy property read, the loader invokes that initializer to create the class,
caches the export, and counts both the read and evaluation. Every registration and cold-resolution sample starts with
a fresh loader. This models cache-on-first-read behavior without inventing arbitrary module-body or transitive-import
work, so it should be read as a lower-bound simulation rather than a production lazy-loader performance estimate.

The already-loaded case creates all classes before sampling, uses ordinary class references, and shows the portable
overhead when lookup cannot defer module evaluation.

## Results

### Simulated lazy export loader, cold modules

| Classes | Eager registration (ms) | Lazy registration (ms) | Registration reads eager / lazy | Registration evaluations eager / lazy | First eager / lazy (ms) | All eager / lazy (ms) | Hot eager / lazy (ns/get) |
| ------: | ----------------------: | ---------------------: | ------------------------------: | ------------------------------------: | ----------------------: | --------------------: | ------------------------: |
|      10 |                  0.0127 |                 0.0102 |                          10 / 0 |                                10 / 0 |         0.0026 / 0.0027 |       0.0079 / 0.0134 |               13.3 / 12.3 |
|     100 |                  0.1464 |                 0.1216 |                         100 / 0 |                               100 / 0 |         0.0186 / 0.0166 |       0.0871 / 0.1899 |               12.6 / 13.0 |
|   1,000 |                  6.2559 |                 6.8024 |                       1,000 / 0 |                             1,000 / 0 |         0.1276 / 0.1345 |       0.8335 / 1.3848 |               14.1 / 14.5 |

### Already-loaded classes

| Classes | Eager registration (ms) | Lazy registration (ms) | First eager / lazy (ms) | All eager / lazy (ms) | Hot eager / lazy (ns/get) |
| ------: | ----------------------: | ---------------------: | ----------------------: | --------------------: | ------------------------: |
|      10 |                  0.0059 |                 0.0100 |         0.0011 / 0.0015 |       0.0022 / 0.0026 |               12.3 / 13.3 |
|     100 |                  0.0894 |                 0.1522 |         0.0139 / 0.0160 |       0.0344 / 0.0426 |               12.5 / 12.5 |
|   1,000 |                  6.2576 |                 6.3572 |         0.1342 / 0.1389 |       0.3914 / 0.5512 |               14.0 / 14.2 |

## Interpretation

The supported loader claim is structural: lazy registration reduced both module-namespace reads and simulated module
evaluations during registration from one per class to zero. Resolving all services later pays that deferred evaluation
cost: for 1,000 classes, the simulated-loader resolution pass rose from 0.8335 ms eager to 1.3848 ms lazy.

The registration timing itself is not a universal win. Lazy registration was faster for 10 and 100 cold simulated
modules in this run, but slower at 1,000, where the container-chain cost and thunk bookkeeping dominate this deliberately
small initializer. Real loader savings depend on the actual module bodies and transitive imports; these numbers do not
model them.

When classes were already loaded, the thunk added one-time bookkeeping rather than a speedup. In this run, the largest
absolute lazy overhead was about 0.10 ms for registering 1,000 classes and about 0.16 ms for resolving all 1,000. The
relative overhead is more visible for small, very cheap chains because their baseline is measured in microseconds.
After service memoization, eager and lazy `get()` timings were effectively indistinguishable at roughly 12–15 ns/get.

These measurements support documenting the thunk as the default when code may run under a lazy export loader: it
eliminates registration-time triggering reads and evaluations, shifting that work to resolution. They do not show a
performance win for ordinary static ESM, whose modules have already evaluated before registration runs; in that
environment the thunk is primarily a uniform API choice and carries the measured cold-path overhead.
