import { entries } from "./entries";
import type { Memoized } from "./memoize";
import { memoize } from "./memoize";
import type { Container } from "./Container";
import type {
  AddService,
  AddServices,
  InjectableClass,
  InjectableFunction,
  ServicesFromTokenizedParams,
  TokenType,
  ValidTokens,
} from "./types";
import type { ConstructorReturnType } from "./Injectable";
import { ClassInjectable, Injectable } from "./Injectable";

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
 * // We can register Foo, even though the PartialContainer doesn't fulfill the Bar dependency.
 * const partialContainer = new PartialContainer({})
 *   .providesClass('Foo', Foo) // Foo declares static dependencies = ['Bar'] as const
 *
 * // Provide the missing dependency via a Container
 * const combinedContainer = Container
 *   .providesValue('Bar', new Bar())
 *   .provides(partialContainer)
 *
 * // We can resolve Foo, because the combined container includes Bar, so all of Foo's dependencies are now met.
 * const foo = combinedContainer.get('Foo')
 * ```
 */
export class PartialContainer<Services = {}, Dependencies = {}> {
  /**
   * Creates a new PartialContainer from a plain object containing service definitions.
   * Each property of the object is registered as a value service with no dependencies.
   *
   * @example
   * ```ts
   * const partial = PartialContainer.fromObject({ apiUrl: "https://api.example.com", timeout: 5000 });
   * const container = Container.provides(partial);
   * console.log(container.get('apiUrl')); // "https://api.example.com"
   * ```
   *
   * @param services A plain object where each property maps to a service value.
   * @returns A new PartialContainer populated with the provided services and no dependencies.
   */
  static fromObject<Services extends { [s: string]: any }>(services: Services): PartialContainer<Services, {}> {
    let container: PartialContainer<any, any> = new PartialContainer({});
    for (const [token, value] of entries(services)) {
      container = container.providesValue(token, value);
    }
    return container as PartialContainer<Services, {}>;
  }

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
    // The dependencies of the new PartialContainer are the combined dependencies of this container and the
    // PartialInjectableFunction -- but we exclude any dependencies already provided by this container (i.e. this
    // container's Services) as well as the new Service being provided.
    ExcludeKey<
      AddDependencies<ExcludeKey<Dependencies, Token>, ServicesFromTokenizedParams<Tokens, AdditionalDependencies>>,
      keyof Services
    >
  >;

  /**
   * Create a new PartialContainer which provides a Service created by a zero-argument factory function.
   *
   * @param token A unique Token identifying the service.
   * @param fn A zero-argument factory function that creates the service.
   */
  provides<Token extends TokenType, Service>(
    token: Token,
    fn: () => Service
  ): PartialContainer<AddService<Services, Token, Service>, ExcludeKey<Dependencies, Token>>;

  /**
   * Create a new PartialContainer which provides a Service created by a factory function with dependencies.
   * Dependencies that are not already provided by this PartialContainer will be tracked and must be
   * fulfilled by the Container this PartialContainer is eventually provided to.
   *
   * @param token A unique Token identifying the service.
   * @param dependencies A readonly array of tokens for the factory's dependencies.
   * @param fn A factory function whose parameters match the dependencies.
   */
  provides<Token extends TokenType, const Tokens extends readonly TokenType[], Params extends readonly any[], Service>(
    token: Token,
    dependencies: Tokens,
    fn: (...args: Tokens["length"] extends Params["length"] ? Params : void[]) => Service
  ): Tokens["length"] extends Params["length"]
    ? PartialContainer<
        AddService<Services, Token, Service>,
        ExcludeKey<
          AddDependencies<ExcludeKey<Dependencies, Token>, ServicesFromTokenizedParams<Tokens, Params>>,
          keyof Services
        >
      >
    : never;

  /**
   * Merges services from another PartialContainer into this one.
   * Dependencies from both containers are combined, with any dependencies satisfied by
   * the other container's services removed.
   *
   * @param container The PartialContainer whose services will be merged.
   */
  provides<AdditionalServices, AdditionalDependencies>(
    container: PartialContainer<AdditionalServices, AdditionalDependencies>
  ): PartialContainer<
    AddServices<Services, AdditionalServices>,
    ExcludeKey<AddDependencies<Dependencies, AdditionalDependencies>, keyof Services | keyof AdditionalServices>
  >;

  /**
   * Merges services from a Container into this PartialContainer.
   * Since Container services are fully resolved, they add no new dependencies
   * and may satisfy existing ones.
   *
   * @param container The Container whose services will be merged.
   */
  provides<AdditionalServices>(
    container: Container<AdditionalServices>
  ): PartialContainer<AddServices<Services, AdditionalServices>, ExcludeKey<Dependencies, keyof AdditionalServices>>;

  provides(first: any, second?: any, third?: any): PartialContainer<any, any> {
    // Two-arg form: provides(token, factory)
    if (typeof second === "function") {
      return new PartialContainer({ ...this.injectables, [first]: Injectable(first, second) } as any);
    }
    // Three-arg form: provides(token, dependencies, factory)
    if (Array.isArray(second) && typeof third === "function") {
      const fn = Injectable(first, second, third);
      return new PartialContainer({ ...this.injectables, [first]: fn } as any);
    }
    // provides(PartialContainer)
    if (first instanceof PartialContainer) {
      return new PartialContainer({ ...this.injectables, ...first.injectables } as any);
    }
    // provides(Container) — duck-type via 'factories' property
    if (first && "factories" in first) {
      const containerInjectables: any = {};
      for (const key of Object.keys(first.factories)) {
        const factory = first.factories[key];
        const fn: any = () => factory();
        fn.token = key;
        fn.dependencies = [];
        containerInjectables[key] = fn;
      }
      return new PartialContainer({ ...this.injectables, ...containerInjectables } as any);
    }
    // Original single-arg form: provides(InjectableFunction)
    return new PartialContainer({ ...this.injectables, [first.token]: first } as any);
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
  providesValue = <Token extends TokenType, Service>(token: Token, value: Service) =>
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
   * @param cls the class to be provided, must match the InjectableClass type.
   */
  providesClass = <
    Class extends InjectableClass<any, any, any>,
    AdditionalDependencies extends ConstructorParameters<Class>,
    Tokens extends Class["dependencies"],
    Service extends ConstructorReturnType<Class>,
    Token extends TokenType,
  >(
    token: Token,
    cls: Class
  ) => this.provides<AdditionalDependencies, Tokens, Token, Service>(ClassInjectable(token, cls));

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
