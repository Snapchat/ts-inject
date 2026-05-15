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

/**
 * A reified, type-branded contribution to a registry shape `S`, requiring extra dependencies `D`
 * from the core container at compose time.
 *
 * Multibindings are produced by {@link bind} and applied via {@link compose}. They let separate
 * modules contribute to the same array-typed registry tokens (e.g. `plugins`, `middlewares`)
 * without sharing a Container chain — the contributions are values that can be exported,
 * imported, and composed in one place.
 *
 * `D` is phantom: it carries the union of dependency keys the binding's contributions need,
 * so `compose` can verify the core container satisfies them.
 */
export type Multibinding<S, D = {}> = ((core: Container<S & D>) => Container<S & D>) & {
  readonly __deps?: D;
};

/**
 * Type-level validator for `compose`: passes a binding through unchanged if its phantom deps
 * are satisfied by the core's services, otherwise tags it with a `missingDeps` field naming
 * the keys it needs.
 */
type Validated<Core, Mb> = Mb extends Multibinding<any, infer D>
  ? unknown extends D
    ? Mb
    : keyof D extends keyof Core
      ? Mb
      : Mb & { readonly missingDeps: Exclude<keyof D & string, keyof Core & string> }
  : never;

/**
 * Builder for a single {@link Multibinding}. Tracks four type parameters:
 *  - `S`        — the registry shape (phantom; usually `typeof registryContainer`).
 *  - `Internal` — services brought along via {@link MultibindingBuilder.withInternal}, used to
 *                 satisfy contribution dependencies without forwarding them to the core container.
 *  - `IDeps`    — unresolved dependencies of the internal `PartialContainer`, which *do* flow
 *                 to the core.
 *  - `Deps`     — dependencies of class/injectable contributions that aren't satisfied by
 *                 `Internal`, which also flow to the core.
 *
 * The final {@link Multibinding} aggregates `IDeps & Deps` as its phantom `D`.
 */
export class MultibindingBuilder<S, Internal = {}, IDeps = {}, Deps = {}> {
  constructor(private readonly apply: (core: Container<any>) => Container<any>) {}

  /**
   * Contribute a literal value to one of the registry's array tokens.
   *
   * @example
   * ```ts
   * bind<Registry>().contributeValue("plugins", inlinePlugin).build();
   * ```
   */
  contributeValue<T extends ArrayTokens<S>>(
    token: T,
    value: ElementOf<S[T]>
  ): MultibindingBuilder<S, Internal, IDeps, Deps> {
    return new MultibindingBuilder<S, Internal, IDeps, Deps>((c) =>
      this.apply(c).appendValue(token as never, value as never)
    );
  }

  /**
   * Contribute an instance of a class to one of the registry's array tokens. The class's
   * `static dependencies` are added to the binding's required deps and validated at
   * {@link compose} time — dependencies already provided by a {@link withInternal} are subtracted.
   *
   * @example
   * ```ts
   * class AuthPlugin {
   *   static dependencies = ["config"] as const;
   *   constructor(private config: Config) {}
   * }
   *
   * bind<Registry>().contributeClass("plugins", AuthPlugin).build();
   * ```
   */
  contributeClass<
    T extends ArrayTokens<S>,
    Class extends InjectableClass<any, ElementOf<S[T]>, readonly string[]>,
  >(
    token: T,
    cls: Class
  ): MultibindingBuilder<S, Internal, IDeps, Deps & Omit<DepsForClass<Class>, keyof Internal>> {
    return new MultibindingBuilder<S, Internal, IDeps, Deps & Omit<DepsForClass<Class>, keyof Internal>>(
      (c) => this.apply(c).appendClass(token as never, cls as never)
    );
  }

  /**
   * Contribute a pre-built {@link InjectableFunction} to a registry token. The injectable's
   * own token determines which array it contributes to, and its declared `dependencies` are
   * added to the binding's required deps (minus anything already provided by {@link withInternal}).
   *
   * Use this when a contribution needs a non-trivial factory — e.g. one that closes over
   * configuration or composes other services — but doesn't fit the class shape.
   *
   * @example
   * ```ts
   * import { Injectable } from "@snap/ts-inject";
   *
   * const metricsPlugin = Injectable(
   *   "plugins",
   *   ["config", "logger"] as const,
   *   (config: Config, logger: Logger) => new MetricsPlugin(config, logger)
   * );
   *
   * bind<Registry>().contribute(metricsPlugin).build();
   * ```
   */
  contribute<
    T extends ArrayTokens<S>,
    F extends InjectableFunction<any, readonly string[], T, ElementOf<S[T]>>,
  >(
    fn: F
  ): MultibindingBuilder<S, Internal, IDeps, Deps & Omit<DepsForInjectable<F>, keyof Internal>> {
    return new MultibindingBuilder<S, Internal, IDeps, Deps & Omit<DepsForInjectable<F>, keyof Internal>>(
      (c) => this.apply(c).append(fn as never)
    );
  }

  /**
   * Attach a {@link PartialContainer} of private services that subsequent contributions in this
   * binding can depend on. The partial's *unresolved* dependencies become required deps of the
   * binding; its provided services are visible to later `contributeClass` / `contribute` calls
   * but not exposed outside the binding's runtime scope.
   *
   * Chain `withInternal` **before** the contributions that depend on its services so the
   * compile-time dep subtraction has the necessary information.
   *
   * @example
   * ```ts
   * const internal = new PartialContainer({})
   *   .provides("retryPolicy", ["config"] as const, (c: Config) => new RetryPolicy(c));
   *
   * bind<Registry>()
   *   .withInternal(internal)
   *   .contributeClass("plugins", HttpPlugin) // depends on retryPolicy + anything in core
   *   .build();
   * ```
   */
  withInternal<I extends PartialContainer<any, any>>(
    internal: I
  ): MultibindingBuilder<S, Internal & ServicesOf<I>, IDeps & InternalDeps<I>, Omit<Deps, keyof ServicesOf<I>>> {
    return new MultibindingBuilder<
      S,
      Internal & ServicesOf<I>,
      IDeps & InternalDeps<I>,
      Omit<Deps, keyof ServicesOf<I>>
    >((c) => this.apply(c.provides(internal) as Container<any>));
  }

  /** Finalize this builder into a portable {@link Multibinding} value. */
  build(): Multibinding<S, IDeps & Deps> {
    return this.apply as Multibinding<S, IDeps & Deps>;
  }
}

/**
 * Start a multibinding against a registry shape `S`.
 *
 * `S` is a phantom — pass `typeof registry` when you already have a Container that declares the
 * array tokens, or a hand-written shape (e.g. `{ plugins: Plugin[] }`) when you don't yet.
 *
 * @example
 * ```ts
 * type Registry = { plugins: Plugin[]; middlewares: Middleware[] };
 *
 * export const authBinding = bind<Registry>()
 *   .contributeClass("plugins", AuthPlugin)
 *   .build();
 * ```
 */
export function bind<S>(): MultibindingBuilder<S> {
  return new MultibindingBuilder<S>((c) => c);
}

/**
 * Apply a list of {@link Multibinding}s to a core container in order, returning a container of
 * the same type. The compiler verifies that every binding's phantom dependencies are present in
 * the core; missing deps appear as a `missingDeps` field on the offending binding in the error.
 *
 * @example
 * ```ts
 * const app = compose(core, authBinding, loggingBinding, metricsBinding);
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
