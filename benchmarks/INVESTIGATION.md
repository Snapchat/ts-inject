# `provides()` Chain Performance Investigation

## TL;DR

Long `Container.provides()` and `PartialContainer.provides()` chains used to construct in O(N²) time. With a few hundred services this caused ANRs on low-end Android devices during container assembly. The fix makes chain construction O(N) per step (~O(N) total) by:

1. Replacing the shallow spread of `this.factories` / `this.injectables` with prototype-chained extension (`Object.create`).
2. Removing the per-step `for...in` loop in the `Container` constructor that rebinds `thisArg` on every already-memoized factory.
3. Replacing `for...in` and `obj[k]` traversal over chained maps with a single-pass `chainedForEach` helper — `for...in` is itself O(N²) on deep `Object.create` chains in V8, as is repeated `[k]` lookup.
4. Materializing a flat own-property snapshot of `factories` on the first `Container.get()` so subsequent reads are O(1) regardless of where the token sits in the prototype chain. Without this, the read path was O(depth-of-token), and a full key sweep over a deep chain was O(N²). The hit is invisible on V8 (inline caches mask it) but real on Hermes — measured ~20× regression vs. the pre-PR flat-map baseline on Snap's mobile DI assembly workload.

End-to-end speedup at chain depth 8000: **Container** 10,286 ms → ~500 ms (~20×), **PartialContainer** 5,199 ms → ~513 ms (~10×). Hot read-path full-sweep on a 1600-deep chain: 13.3 ms/iter → 0.10 ms/iter (~129× on V8; more on engines without prototype-chain ICs). All 93 tests pass with 100% line/branch/function coverage.

## How to reproduce

```bash
npm run bench
```

Runs two sections back-to-back:

1. **Construction + materialization** (`benchmarks/provides-chain.ts`) — Container and PartialContainer chains of 50 → 8000 services, `ms/build`, plus an 800-deep lookup probe and `Container.provides(partial)` materialization cost across the same range.
2. **Read-path** (`benchmarks/get-pass.ts`) — single container, full key sweep in a hot loop at 50 → 1600. This is what surfaced the Hermes regression.

## Numbers

**Container chain construction:**

| N services | before (ms) | after (ms) | speedup |
| ---------- | ----------- | ---------- | ------- |
| 50         | 0.05        | 0.03       | ~1.7×   |
| 100        | 0.19        | 0.08       | 2.4×    |
| 200        | 0.81        | 0.28       | 2.9×    |
| 400        | 4.96        | 0.69       | 7.2×    |
| 800        | 32.08       | 4.27       | 7.5×    |
| 1600       | 309.44      | 18.32      | 16.9×   |
| 3200       | 1518.40     | 75.28      | 20.2×   |
| 8000       | 10285.63    | 495.87     | 20.7×   |

**PartialContainer chain construction:**

| N services | before (ms) | after (ms) | speedup |
| ---------- | ----------- | ---------- | ------- |
| 200        | 0.57        | 0.18       | 3.2×    |
| 800        | 14.20       | 2.67       | 5.3×    |
| 1600       | 134.99      | 15.90      | 8.5×    |
| 3200       | 715.93      | 76.67      | 9.3×    |
| 8000       | 5199.09     | 512.58     | 10.1×   |

**Materialization (`Container.provides(partial)`)** remains a fast linear pass: ~3 ms at N=8000.

**Hot read path** (same container, full key sweep, V8):

| N    | without flatten cache | with flatten cache |
| ---- | --------------------: | -----------------: |
| 50   |              0.004 ms |           0.003 ms |
| 100  |              0.013 ms |           0.005 ms |
| 200  |              0.044 ms |           0.010 ms |
| 400  |              0.180 ms |           0.024 ms |
| 800  |              1.883 ms |           0.069 ms |
| 1600 |             13.313 ms |           0.103 ms |

Without the flatten cache the curve is O(N²); with it the curve is linear (≈ 60 ns per `get` once warmed). On Hermes the original O(N²) was much worse because there's no prototype-chain inline cache to mask it — Snap's mobile team measured ~20× regression on the read path at chain depth 800 before the cache was added.

Measured on Apple silicon, Node 20. Numbers will differ on other devices, but the relative shapes are what matter.

## What was triggering the issue

The report came from a service team observing ANRs on container assembly for low-end devices, with stack traces converging on `Container.provides`. Inspecting the old `providesService`:

```ts
// old
const factories = { ...this.factories, [token]: factory };
return new Container(factories);
```

Plus the `Container` constructor:

```ts
// old
constructor(factories: MaybeMemoizedFactories<Services>) {
  const memoizedFactories = {} as Factories<Services>;
  for (const k in factories) {
    const fn = factories[k];
    if (isMemoized(fn)) {
      memoizedFactories[k] = fn;
      fn.thisArg = this;  // rebind every memoized factory to the new container
    } else {
      memoizedFactories[k] = memoize(this, fn);
    }
  }
  this.factories = memoizedFactories;
}
```

Per `provides()` call, both the spread and the constructor's `for...in` walked **every** factory currently in the container. That's O(N) per step, O(N²) for N chained calls.

The constructor's `thisArg` rebinding existed so that overrides could flow: each memoized factory captured a `thisArg` reference, and when a new container was built (potentially overriding services), all existing factories were re-pointed at the new container so they resolved dependencies through it.

## Options considered

1. **Drop the constructor's `thisArg` rebinding only.** Smaller diff. Removes one of the two O(N) operations per step but the spread remains. Estimated ~2–3× speedup — not enough to clear the ANR threshold at high service counts.
2. **Prototype-chained factories.** Replace `{ ...this.factories, [token]: factory }` with `Object.create(this.factories)` + assign. Per-step construction becomes O(1). Property access on the resulting container walks the prototype chain (O(depth) once per token, then memoized).
3. **Linked-list / parent-pointer container.** Each container holds `(parent, ownFactories)`. Most idiomatic, but a larger refactor and changes the public-ish `factories` field shape.
4. **Persistent immutable map (HAMT etc.).** Over-engineered for the scale (hundreds, not millions, of services).

We went with **(1) + (2) together**. They compose: (1) lets us skip the constructor's per-step walk, (2) lets us skip the spread. Together they bring per-step cost to O(1) and the chain to O(N).

## What changed

- **`src/memoize.ts`** — dropped the `thisArg` field from `Memoized`. Memoized functions now use the call-site `this` (`memo = delegate.apply(this, args)`).
- **`src/Container.ts`**:
  - Constructor: memoizes any non-memoized own factories of the input, rooting the resulting map at a null-prototype object so token names that collide with `Object.prototype` methods (e.g. `"toString"`) don't leak through `get()`.
  - Private `withMemoizedFactories` factory used by internal chain builders that already guarantee memoized input; skips the constructor scan entirely.
  - `get()`: builds a lazy flat own-property snapshot of `factories` on first call and reads from it thereafter, so lookups stay O(1) regardless of prototype-chain depth. Invokes the factory via `factory.call(this)` so dependencies resolve against the calling container.
  - `provides()` (per-token and Container/PartialContainer merge): builds the new factories object via `Object.create(this.factories)` instead of a spread.
  - `copy()`: same prototype-chain approach; only scoped tokens get freshly-memoized own properties.
- **`src/PartialContainer.ts`**:
  - `getFactories()`: drops the now-unused `thisArg` argument to `memoize`; iterates via `chainedForEach` so prototype-chained injectables come through.
  - `addInjectable`, `provides(PartialContainer)`, `provides(Container)`: use `Object.create(this.injectables)` + `chainedForEach` instead of object spread. Per-step cost is now O(1).
  - `getTokens()`: uses `chainedKeys` so chained injectables are included.
- **`src/entries.ts`** — new `chainedForEach` / `chainedKeys` helpers. They walk an object's prototype chain explicitly because `for...in` (and naïve repeated `[k]` lookup) is O(N²) on deep `Object.create` chains in V8; the helpers stay linear (≈90× faster than `for...in` at depth 8000).

## Trade-offs

### First-`get` cost on each container

`Container.get()` materializes a flat own-property snapshot of `factories` on first call. That snapshot pays one O(N) walk of the prototype chain. The total work for `G` gets on a container with `N` services is therefore `N + G` (flatten once + G O(1) reads) instead of `G × depth-of-token` (current pre-cache state) or `G × 1` (pre-chain spread state).

For real cold-start workloads (≥1 `get` per container, often N gets when running a partial), the flatten cost is amortized away and the net change vs. the old flat-map baseline is small. For pathological cases where you build a Container, do exactly one shallow `get`, and discard it, the flatten still walks the whole chain — but in that case the chain is also typically short, and even the pre-cache cost was negligible.

### Subtle semantic shift: parent stays consistent after a fork

Previously, building a child container `C` from a parent `B` mutated `B`'s factories to point their `thisArg` at `C`. As a result, `b.get('svc')` _after_ the fork could resolve dependencies through `C` — meaning the parent was no longer a self-consistent snapshot of its own state.

Now each container is a true snapshot: `b.get('svc')` resolves through `b`. This is captured by the new test `forking a child does not change the parent's view of its services`.

This **is** a behavioral change. It's strictly more correct (and intuitive), and the existing test suite — which covers override-before-init and override-after-init for the _child_ — continues to pass.

### What is _not_ fixed: sibling isolation

Memoization is per-factory, not per-container. If you fork two children `C1` and `C2` from the same parent `B` and override the same token in each, the two siblings share the parent's factory for any service they didn't override. Whichever sibling resolves that service first sets the memoization, and the second sibling sees the cached value.

This was equally broken in the old code (with a different failure mode: whichever container was _built_ most recently won). Sibling isolation requires `copy(['token'])` to un-memoize and re-memoize per scope.

### Public `factories` field

`Container.factories` is `public` for type-emission reasons (see the inline comment in `Container.ts`). Direct invocation of a factory via `container.factories.svc()` used to rely on `thisArg`. After the change, only zero-dep factories work via direct invocation; factories with dependencies need `factory.call(container)` (or just use `container.get('svc')`, which is the supported API).

The one existing test that touches `container.factories.svc()` uses a zero-dep service, so it still passes. No documentation or API change was needed.

## Test coverage

All paths exercised — `npm test` reports:

```
File                 | % Stmts | % Branch | % Funcs | % Lines
All files            |     100 |      100 |     100 |     100
```

with 87/87 tests passing.

Two new tests lock in semantics that the patch introduces:

- `forking a child does not change the parent's view of its services` — parent stays consistent after a fork.
- (Plus four small tests to close pre-existing coverage gaps: constructor slow path with raw factories, `InjectableCompat`, and the two `ConcatInjectable` validation branches.)
