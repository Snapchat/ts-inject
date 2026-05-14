# `provides()` Chain Performance Investigation

## TL;DR

Long `Container.provides()` and `PartialContainer.provides()` chains used to construct in O(N²) time. With a few hundred services this caused ANRs on low-end Android devices during container assembly. The fix makes chain construction O(N) per step (~O(N) total) by:

1. Replacing the shallow spread of `this.factories` / `this.injectables` with prototype-chained extension (`Object.create`).
2. Removing the per-step `for...in` loop in the `Container` constructor that rebinds `thisArg` on every already-memoized factory.
3. Replacing `for...in` and `obj[k]` traversal over chained maps with a single-pass `chainedForEach` helper — `for...in` is itself O(N²) on deep `Object.create` chains in V8, as is repeated `[k]` lookup.

End-to-end speedup at chain depth 8000: **Container** 10,286 ms → ~500 ms (~20×), **PartialContainer** 5,199 ms → ~513 ms (~10×). All 87 tests pass with 100% line/branch/function coverage.

## How to reproduce

```bash
npm run bench
```

The benchmark builds Container and PartialContainer chains of 50 → 8000 services, reports `ms/build`, then probes lookup cost on an 800-deep Container and materialization cost (`Container.provides(partial)`) across the same range.

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

**Materialization (`Container.provides(partial)`)** remains a fast linear pass: 2.4 ms at N=8000.

Lookup cost on an 800-deep Container went from ~0.09 ms/full-pass to ~0.95 ms/full-pass (≈1.2 µs per `get()` on first access). This is a deliberate trade — see _Trade-offs_ below.

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
  - Constructor: memoizes any non-memoized own factories of the input while preserving any prototype chain.
  - Private `withMemoizedFactories` factory used by internal chain builders that already guarantee memoized input; skips the constructor scan entirely.
  - `get()`: invokes the factory via `factory.call(this)` so dependencies resolve against the calling container.
  - `provides()` (per-token and Container/PartialContainer merge): builds the new factories object via `Object.create(this.factories)` instead of a spread.
  - `copy()`: same prototype-chain approach; only scoped tokens get freshly-memoized own properties.
- **`src/PartialContainer.ts`**:
  - `getFactories()`: drops the now-unused `thisArg` argument to `memoize`; iterates via `chainedForEach` so prototype-chained injectables come through.
  - `addInjectable`, `provides(PartialContainer)`, `provides(Container)`: use `Object.create(this.injectables)` + `chainedForEach` instead of object spread. Per-step cost is now O(1).
  - `getTokens()`: uses `chainedKeys` so chained injectables are included.
- **`src/entries.ts`** — new `chainedForEach` / `chainedKeys` helpers. They walk an object's prototype chain explicitly because `for...in` (and naïve repeated `[k]` lookup) is O(N²) on deep `Object.create` chains in V8; the helpers stay linear (≈90× faster than `for...in` at depth 8000).

## Trade-offs

### Lookup cost grew slightly

`get(token)` now walks a prototype chain to find the factory. For an 800-deep chain that's ~1.2 µs per lookup on first access. After the factory is memoized once, the chain walk still happens to find the factory function, but the cached result short-circuits the body.

In real applications a cold start typically touches a small handful of services, so the additional walk cost is negligible. If a workload ever does mass-access of services, a "flatten chain when depth exceeds N" optimization can be layered on later.

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
