import { entries } from "./entries";
import { memoize } from "./memoize";
import type { Memoized } from "./memoize";
import type { Container } from "./Container";
import type { AddService, InjectableFunction, ServicesFromTokenizedParams, TokenType, ValidTokens } from "./types";

// Using a conditional type forces TS language services to evaluate the type -- so when showing e.g. type hints, we
// will see the mapped type instead of the AddDependencies type alias. This produces better hints.
type AddDependencies<ParentDependencies, Dependencies> = ParentDependencies extends any
  ? // A mapped type produces better, more concise type hints than an intersection type.
    {
      [K in keyof ParentDependencies | keyof Dependencies]: K extends keyof ParentDependencies
        ? ParentDependencies[K]
        : K extends keyof Dependencies
          ? Dependencies[K]
          : never;
    }
  : never;

type ExcludeKey<T, U> = T extends any ? { [K in Exclude<keyof T, U>]: T[K] } : never;

type PartialInjectableFunction<
  Params extends readonly any[],
  Tokens extends readonly TokenType[],
  Token extends TokenType,
  Service,
> = {
  (...args: Params): Service;
  token: Token;
  dependencies: Tokens;
};

type Injectables<Services, Dependencies> = {
  [K in keyof Services]: K extends TokenType
    ? InjectableFunction<Services & Dependencies, readonly ValidTokens<Services & Dependencies>[], K, Services[K]>
    : never;
};

type PartialContainerFactories<Services> = {
  [K in keyof Services]: Memoized<() => Services[K]>;
};

/**
 * Similar to [Container], with the exception that Services may be provided to a PartialContainer which *does not*
 * contain all of that Services dependencies.
 *
 * For this to remain safe, Services can not be resolved by PartialContainer – it has no `get` method.
 *
 * Instead, the PartialContainer must be provided to a [Container] which *does* contain all the dependencies required
 * by all the Service in the PartialContainer. The resulting [Container] can then resolve these Services.
 *
 * PartialContainers are used to create a collection of Services which can then be provided via a simple one-line syntax
 * to an existing Container (which fulfills the collection's dependencies). It is an organizational tool, allowing
 * coherent groupings of Services to be defined in one place, then combined elsewhere to form a complete [Container].
 *
 * Here's an example of PartialContainer usage:
 * ```ts
 * // We can provide fooFactory, even though the PartialContainer doesn't fulfill the Bar dependency.
 * const fooFactory = Injectable('Foo', ['Bar'] as const, (bar: Bar) => new Foo(bar))
 * const partialContainer = new PartialContainer({}).provide(fooFactory)
 *
 * const barFactory = Injectable('Bar', () => new Bar())
 * const dependenciesContainer = Container.provides(barFactory)
 *
 * const combinedContainer = dependenciesContainer.provides(partialContainer)
 *
 * // We can resolve Foo, because the combined container includes Bar, so all of Foo's dependencies are now met.
 * const foo = combinedContainer.get('Foo')
 * ```
 */
export class PartialContainer<Services = {}, Dependencies = {}> {
  constructor(private readonly injectables: Injectables<Services, Dependencies>) {}

  /**
   * Create a new PartialContainer which provides a Service created by the given InjectableFunction.
   *
   * The InjectableFunction contains metadata specifying the Token by which the created Service will be known, as well
   * as an ordered list of Tokens to be resolved and provided to the InjectableFunction as arguments.
   *
   * This dependencies are allowed to be missing from the PartialContainer, but these dependencies are maintained as a
   * parameter of the returned PartialContainer. This allows `[Container.provides]` to type check the dependencies and
   * ensure they can be provided by the Container.
   *
   * @param fn A InjectableFunction, taking dependencies as arguments, which returns the Service.
   */
  provides<
    AdditionalDependencies extends readonly any[],
    Tokens extends readonly TokenType[],
    Token extends TokenType,
    Service,
  >(
    fn: PartialInjectableFunction<AdditionalDependencies, Tokens, Token, Service>
  ): PartialContainer<
    AddService<Services, Token, Service>,
    // The dependencies of the new PartialContainer are the combined dependencies of this container and the
    // PartialInjectableFunction -- but we exclude any dependencies already provided by this container (i.e. this
    // container's Services) as well as the new Service being provided.
    ExcludeKey<
      AddDependencies<ExcludeKey<Dependencies, Token>, ServicesFromTokenizedParams<Tokens, AdditionalDependencies>>,
      keyof Services
    >
  > {
    return new PartialContainer({ ...this.injectables, [fn.token]: fn } as any);
  }

  /**
   * In order to create a [Container], the InjectableFunctions maintained by the PartialContainer must be memoized
   * into Factories that can resolve their dependencies and return the correct Service.
   *
   * In particular, this requires access to a "parent" Container to avoid infinite looping in cases where Service A
   * depends on Service A – this is allowed (as long as the parent container provides Service A), but requires access
   * to the parent Container to provide the parent implementation of Service A.
   *
   * This also means that Services provided by a PartialContainer to a Container via this function will always be
   * scoped to the Container. In other words, if a PartialContainer containing Service A is provided to both
   * Container X and Container Y, when Service A is resolved by Container X the InjectableFunction used to create
   * Service A will be invoked – and when Service A is resolved by Container Y, the InjectableFunction will be invoked
   * again.
   *
   * @param parent A [Container] which provides all the required Dependencies of this PartialContainer.
   */
  getFactories(parent: Container<Dependencies>): PartialContainerFactories<Services> {
    let factories: PartialContainerFactories<Services> | undefined = undefined;
    return (factories = Object.fromEntries(
      entries(this.injectables).map(([token, fn]) => [
        token,
        memoize(parent, () =>
          fn(
            ...(fn.dependencies.map((t) => {
              return t === token
                ? parent.get(t as keyof Dependencies)
                : factories![t as keyof Services & Dependencies]
                  ? factories![t]()
                  : parent.get(t as keyof Dependencies);
            }) as any)
          )
        ),
      ])
    ) as PartialContainerFactories<Services>);
  }

  getTokens(): Array<keyof Services> {
    return Object.keys(this.injectables) as Array<keyof Services>;
  }
}
