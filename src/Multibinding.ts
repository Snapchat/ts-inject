import type { Container } from "./Container";
import type { PartialContainer } from "./PartialContainer";
import type { InjectableClass, InjectableFunction } from "./types";

type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/** Tokens of `S` whose service type is a readonly array — the only tokens a multibinding can contribute to. */
type ArrayTokens<S> = { [K in keyof S]: S[K] extends readonly unknown[] ? K : never }[keyof S];

type DepsForClass<C> = C extends { readonly dependencies: readonly (infer K extends string)[] }
  ? Record<K, unknown>
  : {};

type DepsForInjectable<F> = F extends InjectableFunction<any, infer Tokens, any, any>
  ? Tokens extends readonly (infer K extends string)[]
    ? Record<K, unknown>
    : {}
  : {};

type ServicesOf<I> = I extends PartialContainer<infer S, any> ? S : never;
type InternalDeps<I> = I extends PartialContainer<any, infer D> ? D : never;

/** Aggregate the phantom `D` of a tuple of Multibindings into a single dependency record. */
type UnionDeps<Mbs> = Mbs extends readonly [infer H, ...infer R]
  ? (H extends Multibinding<any, infer D> ? D : {}) & UnionDeps<R>
  : {};

/**
 * A reified, type-branded contribution to a registry shape `S`, requiring extra dependencies `D`
 * from the core container at compose time.
 *
 * Multibindings are values that can be exported, imported, combined, and finally applied with
 * {@link compose}. They let separate modules contribute to the same array-typed registry tokens
 * (e.g. `plugins`, `middlewares`) without sharing a Container chain.
 *
 * `D` is phantom: it carries the union of dependency keys the contribution needs, so `compose`
 * can verify the core container satisfies them.
 */
export type Multibinding<S, D = {}> = ((core: Container<S & D>) => Container<S & D>) & {
  readonly __deps?: D;
};

/**
 * Type-level validator for `compose`: passes a binding through unchanged if its phantom deps are
 * satisfied by the core's services, otherwise tags it with a `missingDeps` field naming the keys
 * it needs.
 */
type Validated<Core, Mb> = Mb extends Multibinding<any, infer D>
  ? unknown extends D
    ? Mb
    : keyof D extends keyof Core
      ? Mb
      : Mb & { readonly missingDeps: Exclude<keyof D & string, keyof Core & string> }
  : never;

/**
 * Family of multibinding helpers bound to a specific registry shape `S`.
 *
 * Obtained from {@link multibindings} — either by passing a Container so `S` is inferred from
 * its services, or by supplying `S` as a type argument when no Container instance is available.
 */
export interface MultibindingFactory<S> {
  /**
   * Produce a {@link Multibinding}. Three call shapes:
   *  - `contribute(token, value)` — appends a literal value.
   *  - `contribute(token, ClassWithDeps)` — appends an instance built from an
   *    {@link InjectableClass}; its `static dependencies` become the binding's required deps.
   *  - `contribute(injectable)` — appends a value produced by a pre-built
   *    {@link InjectableFunction}; the function's `token` selects the array, and its declared
   *    `dependencies` become the binding's required deps.
   */
  contribute: {
    <
      T extends ArrayTokens<S>,
      F extends InjectableFunction<any, readonly string[], T, ElementOf<S[T]>>,
    >(
      injectable: F
    ): Multibinding<S, DepsForInjectable<F>>;
    <
      T extends ArrayTokens<S>,
      Class extends InjectableClass<any, ElementOf<S[T]>, readonly string[]>,
    >(
      token: T,
      cls: Class
    ): Multibinding<S, DepsForClass<Class>>;
    <T extends ArrayTokens<S>>(token: T, value: ElementOf<S[T]>): Multibinding<S, {}>;
  };
}

function contributeImpl(first: unknown, second?: unknown): Multibinding<any, any> {
  // 1-arg form: contribute(injectable). The injectable carries its own token.
  if (second === undefined) {
    const fn = first as InjectableFunction<any, readonly string[], string, unknown>;
    return ((core: Container<any>) => core.append(fn as never)) as Multibinding<any, any>;
  }
  const token = first as never;
  // 2-arg form, class: a function carrying a `dependencies` array (Injectables also carry one,
  // but those should use the 1-arg form, and would be missing the `new`-ability `appendClass` expects).
  if (typeof second === "function" && Array.isArray((second as { dependencies?: unknown }).dependencies)) {
    const cls = second as InjectableClass<any, unknown, readonly string[]>;
    return ((core: Container<any>) => core.appendClass(token, cls as never)) as Multibinding<any, any>;
  }
  // 2-arg form, value.
  return ((core: Container<any>) => core.appendValue(token, second as never)) as Multibinding<any, any>;
}

/**
 * Capture a registry shape so subsequent contribution calls don't need to repeat it. Two forms:
 *
 *  - `multibindings(registryContainer)` — infers `S` from the container's services.
 *  - `multibindings<S>()` — when only a type alias is available.
 *
 * Returns a {@link MultibindingFactory} with a `contribute` method whose overloads cover values,
 * {@link InjectableClass}es, and pre-built {@link InjectableFunction}s.
 *
 * @example
 * ```ts
 * // With a Container instance:
 * const m = multibindings(registry);
 * export const authBinding = m.contribute("plugins", AuthPlugin);
 *
 * // With only a type:
 * const m = multibindings<Registry>();
 * export const inlineBinding = m.contribute("plugins", { name: "x", run: () => "x" });
 * ```
 */
export function multibindings<S>(): MultibindingFactory<S>;
export function multibindings<S>(registry: Container<S>): MultibindingFactory<S>;
export function multibindings<S>(_registry?: Container<S>): MultibindingFactory<S> {
  return { contribute: contributeImpl as MultibindingFactory<S>["contribute"] };
}

/**
 * Bundle several {@link Multibinding}s that target the same registry shape into one. The
 * resulting binding's deps are the union of the inputs' deps and contributions are applied
 * left-to-right.
 *
 * Use this when one module exports several related contributions and you'd rather pass a single
 * value to {@link compose}.
 *
 * @example
 * ```ts
 * const m = multibindings<Registry>();
 *
 * export const authBindings = combine(
 *   m.contribute("plugins", AuthPlugin),
 *   m.contribute("plugins", OAuthPlugin),
 *   m.contribute(authMetricsInjectable),
 * );
 * ```
 */
export function combine<S, const Mbs extends readonly Multibinding<S, any>[] = readonly []>(
  ...bindings: Mbs
): Multibinding<S, UnionDeps<Mbs>> {
  return ((core: Container<any>) =>
    bindings.reduce<Container<any>>(
      (c, mb) => (mb as (c: Container<any>) => Container<any>)(c),
      core
    )) as Multibinding<S, UnionDeps<Mbs>>;
}

/**
 * Apply contributions against a private {@link PartialContainer} of helpers that's invisible to
 * other bindings and to consumers of the composed container's type.
 *
 * The partial's *unresolved* dependencies flow to the core; its *provided* services are
 * subtracted from the contributions' deps. Subtraction is non-positional: every binding inside
 * the call sees the partial.
 *
 * @example
 * ```ts
 * const m = multibindings<Registry>();
 * const retryInternal = new PartialContainer({}).provides(
 *   "retryPolicy",
 *   ["maxRetries"] as const,
 *   (n: number) => new RetryPolicy(n)
 * );
 *
 * // HttpPlugin.dependencies = ["retryPolicy", "endpoint"]
 * // → the composed binding requires { endpoint, maxRetries } — retryPolicy is internal.
 * export const httpBinding = withInternal(retryInternal,
 *   m.contribute("plugins", HttpPlugin),
 * );
 * ```
 */
export function withInternal<
  S,
  I extends PartialContainer<any, any>,
  const Mbs extends readonly Multibinding<S, any>[],
>(
  internal: I,
  ...bindings: Mbs
): Multibinding<S, Omit<UnionDeps<Mbs>, keyof ServicesOf<I>> & InternalDeps<I>> {
  return ((core: Container<any>) => {
    const merged = core.provides(internal) as Container<any>;
    return bindings.reduce<Container<any>>(
      (c, mb) => (mb as (c: Container<any>) => Container<any>)(c),
      merged
    );
  }) as Multibinding<S, Omit<UnionDeps<Mbs>, keyof ServicesOf<I>> & InternalDeps<I>>;
}

/**
 * Apply a list of {@link Multibinding}s to a core container in order, returning a container of
 * the same type. The compiler verifies that every binding's phantom dependencies are present in
 * the core; missing deps appear as a `missingDeps` field on the offending binding in the error.
 *
 * @example
 * ```ts
 * const app = compose(core, authBinding, httpBinding, metricsBinding);
 * ```
 */
export function compose<Core, const Mbs extends readonly Multibinding<any, any>[]>(
  core: Container<Core>,
  ...bindings: { [I in keyof Mbs]: Validated<Core, Mbs[I]> }
): Container<Core> {
  return (bindings as readonly Multibinding<any, any>[]).reduce<Container<any>>(
    (c, mb) => (mb as (c: Container<any>) => Container<any>)(c),
    core
  ) as Container<Core>;
}
