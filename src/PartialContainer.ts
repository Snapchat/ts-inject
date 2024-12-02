import { entries } from "./entries";
import type { Memoized } from "./memoize";
import { memoize } from "./memoize";
import type { Container } from "./Container";
import type { AddService, InjectableFunction, ServicesFromTokenizedParams, TokenType, ValidTokens } from "./types";
import { Injectable } from "./Injectable";

/**
 * Combines two dependency maps into one, merging properties from both `ParentDependencies` and `Dependencies`.
 * If a key exists in both, the value from `ParentDependencies` is used.
 *
 * This type is used to aggregate dependencies in a way that provides better type hints and readability in IDEs,
 * because using a conditional type forces TypeScript to evaluate and display the resulting mapped type directly,
 * rather than just the type alias name.
 *
 * @typeParam ExistingDependencies - The existing set of dependencies.
 * @typeParam NewDependencies - The new dependencies to add.
 *
 * @remarks
 * The use of a mapped type over an intersection type produces more concise and informative type hints.
 *
 * @example
 * ```typescript
 * type A = { foo: number; bar: string };
 * type B = { bar: boolean; baz: Date };
 * type Combined = AddDependencies<A, B>;
 * // Combined is { foo: number; bar: string; baz: Date }
 * ```
 */
type AddDependencies<ExistingDependencies, NewDependencies> = ExistingDependencies extends any
  ? // A mapped type produces better, more concise type hints than an intersection type.
    {
      [K in keyof ExistingDependencies | keyof NewDependencies]: K extends keyof ExistingDependencies
        ? ExistingDependencies[K]
        : K extends keyof NewDependencies
          ? NewDependencies[K]
          : never;
    }
  : never;

/**
 * Updates the dependencies of a container by combining existing dependencies with new ones,
 * while excluding any dependencies that are already satisfied by the container's existing services
 * or the new service being provided.
 *
 * Specifically:
 * - It removes the `NewToken` from `ExistingDependencies` to avoid circular dependencies.
 * - It excludes keys from `NewDependencies` that are already present in `ExistingServices`
 * since those dependencies are already resolved.
 * - It then combines the resulting dependencies into a new dependency map.
 *
 * @typeParam ExistingServices - The services already provided by the container.
 * @typeParam ExistingDependencies - The current dependencies of the container.
 * @typeParam NewToken - The token of the new service being added to the container.
 * @typeParam NewDependencies - The dependencies required by the new service.
 *
 * @example
 * ```typescript
 * type ExistingServices = { foo: number };
 * type ExistingDependencies = { bar: string; baz: boolean };
 * type NewToken = 'qux';
 * type NewDependencies = { baz: boolean; quux: Date };
 * type Updated = UpdateDependencies<ExistingServices, ExistingDependencies, NewToken, NewDependencies>;
 * // Updated is { bar: string; quux: Date }
 * ```
 */
type UpdateDependencies<
  ExistingServices,
  ExistingDependencies,
  NewToken extends TokenType,
  NewDependencies,
> = AddDependencies<ExcludeKey<ExistingDependencies, NewToken>, ExcludeKey<NewDependencies, keyof ExistingServices>>;

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
   * The dependencies are allowed to be missing from the PartialContainer, but these dependencies are maintained as a
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
    UpdateDependencies<Services, Dependencies, Token, ServicesFromTokenizedParams<Tokens, AdditionalDependencies>>
  > {
    return new PartialContainer({ ...this.injectables, [fn.token]: fn } as any);
  }

  /**
   * Create a new PartialContainer which provides the given value as a Service.
   *
   * Example:
   * ```ts
   * const partial = new PartialContainer({}).providesValue("value", 42);
   * const value = Container.provides(partial).get("value");
   * console.log(value); // 42
   * ```
   *
   * @param token the Token by which the value will be known.
   * @param value the value to be provided.
   */
  providesValue = <Token extends TokenType, Service>(
    token: Token,
    value: Service
  ): PartialContainer<AddService<Services, Token, Service>, UpdateDependencies<Services, Dependencies, Token, {}>> =>
    this.provides(Injectable(token, [], () => value));

  /**
   * Create a new PartialContainer which provides the given class as a Service, all of the class's dependencies will be
   * resolved by the parent Container.
   *
   * Example:
   * ```ts
   * class Foo {
   *  static dependencies = ['bar'] as const;
   *  constructor(public bar: string) {}
   * }
   *
   * const partial = new PartialContainer({}).providesClass("foo", Foo);
   * const foo = Container.providesValue("bar", "bar value").provides(partial).get("foo");
   * console.log(foo.bar); // "bar value"
   * ```
   *
   * @param token the Token by which the class will be known.
   * @param cls the class to be provided.
   */
  providesClass = <
    Token extends TokenType,
    Tokens extends readonly TokenType[],
    Params extends readonly any[] & { length: Tokens["length"] },
    Service,
  >(
    token: Token,
    cls: {
      readonly dependencies: Tokens;
      new (...args: Params): Service;
    }
  ): PartialContainer<
    AddService<Services, Token, Service>,
    UpdateDependencies<Services, Dependencies, Token, ServicesFromTokenizedParams<Tokens, Params>>
  > => {
    const injectable = (...args: Params) => new cls(...args);
    injectable.dependencies = cls.dependencies;
    injectable.token = token;
    return this.provides(injectable);
  };

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
