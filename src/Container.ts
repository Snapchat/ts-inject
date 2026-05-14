import type { Memoized } from "./memoize";
import { isMemoized, memoize } from "./memoize";
import { PartialContainer } from "./PartialContainer";
import type {
  AddService,
  AddServices,
  CorrespondingServices,
  InjectableClass,
  InjectableFunction,
  TokenType,
  ValidTokens,
} from "./types";
import { ClassInjectable, ConcatInjectable, Injectable } from "./Injectable";
import { chainedForEach, entries } from "./entries";

type MaybeMemoizedFactories<Services> = {
  [K in keyof Services]: (() => Services[K]) | Memoized<() => Services[K]>;
};

type Factories<Services> = {
  [K in keyof Services]: Memoized<() => Services[K]>;
};

/**
 * A special token used to resolve the entire container as a dependency.
 * This can be utilized when a service needs access to the container itself,
 * allowing for dynamic retrieval of other services.
 *
 * @example
 *
 * ```ts
 * const initial = Container.providesValue("value", 1);
 * const extended = initial.provides(
 *   Injectable("service", [CONTAINER], (container: typeof initial) => {
 *     return container.get("value") + 1;
 *   })
 * );
 *
 * const result = extended.get("service"); // 2
 * ```
 */
export const CONTAINER = "$container";
export type ContainerToken = typeof CONTAINER;

type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

/**
 * Represents the dependency injection container that manages the registration,
 * creation, and retrieval of services. The Container class is central to
 * the dependency injection process, facilitating typesafe injection and
 * retrieval of services based on tokens.
 *
 * @example
 *
 * ```ts
 * const container = Container
 *   .providesValue('config', { port: 3000 })
 *   .providesClass('Logger', Logger)
 *   .providesClass('Server', Server)
 *
 * const server = container.get('Server')
 * ```
 */
export class Container<Services = {}> {
  /**
   * Creates a new [Container] by providing a [PartialContainer] that has no dependencies.
   *
   * @example
   * ```ts
   * // Extend a container with a partial container or another container
   * const container = Container.provides(existingPartialContainer);
   * const container2 = Container.provides(existingContainer);
   * ```
   */
  static provides<Services>(container: PartialContainer<Services, {}> | Container<Services>): Container<Services>;

  /**
   * Creates a new [Container] by providing a Service that has no dependencies,
   * using a pre-built {@link InjectableFunction}.
   *
   * **Tip:** Prefer the inline form `Container.provides('token', () => value)` instead.
   */
  static provides<Token extends TokenType, Service>(
    fn: InjectableFunction<{}, [], Token, Service>
  ): Container<AddService<{}, Token, Service>>;

  /**
   * Creates a new [Container] by providing a Service via a zero-argument factory function.
   * The factory is called lazily on first retrieval and the result is memoized.
   *
   * @example
   * ```ts
   * const container = Container.provides('Logger', () => new Logger());
   * ```
   */
  static provides<Token extends TokenType, Service>(
    token: Token,
    fn: () => Service
  ): Container<AddService<{}, Token, Service>>;

  static provides(first: any, second?: any): Container<any> {
    if (typeof second === "function") return new Container({}).provides(first, second);
    // Although the `provides` method has overloads that match both members of the union type separately, it does
    // not match the union type itself, so the compiler forces us to branch and handle each type within the union
    // separately. (Maybe in the future the compiler will decide to infer this, but for now this is necessary.)
    if (first instanceof PartialContainer) return new Container({}).provides(first);
    if (first instanceof Container) return new Container({}).provides(first);
    return new Container({}).provides(first);
  }

  /**
   * Registers a static value as a service in a new Container. Ideal for services that don't require
   * instantiation or dependencies.

   * NOTE: This method acts as a syntactic shortcut, essentially registering a factory function that
   * directly returns the provided value.
   *
   * @example
   * ```ts
   * // Registering an instance of a class
   * const logger = new Logger();
   * const container = Container.providesValue('Logger', logger);
   *
   * // This is effectively a shortcut for
   * const container2 = Container.provides('Logger', () => logger);
   * ```
   *
   * @param token A unique Token identifying the service within the container. This token is used to retrieve the value.
   * @param value The value or instance to register as a service within the container. This can be of any type.
   * @returns A new Container instance with the specified service registered.
   */
  static providesValue<Token extends TokenType, Service>(
    token: Token,
    value: Service
  ): Container<AddService<{}, Token, Service>> {
    return new Container({}).providesValue(token, value);
  }

  /**
   * Creates a new Container from a plain object containing service definitions.
   * Each property of the object is treated as a unique token,
   * and its corresponding value is registered in the Container as a service under that token.
   * This method offers a convenient way to quickly bootstrap a container with predefined services.
   *
   * @example
   * ```ts
   * // Creating a container with simple value services
   * const container = Container.fromObject({ foo: 1, bar: 'baz' });
   *
   * // Retrieving services from the container
   * console.log(container.get('foo')); // prints 1
   * console.log(container.get('bar')); // prints 'baz'
   * ```
   *
   * In this example, `container` is of type `Container<{ foo: number, bar: string }>` indicating
   * that it holds services under the tokens 'foo' and 'bar' with corresponding types.
   *
   * @param services A plain object where each property (token) maps to a service value. This object
   * defines the initial set of services to be contained within the new Container instance.
   * @returns A new Container instance populated with the provided services.
   */
  static fromObject<Services extends { [s: string]: any }>(services: Services): Container<Services> {
    return entries(services).reduce(
      (container, [token, value]) => container.providesValue(token, value),
      new Container({})
    ) as Container<Services>;
  }

  /**
   * Trusted internal construction: skips the per-key memoization scan the public constructor
   * performs, since chain-building paths (`provides`, `copy`, etc.) prepare factories that
   * are guaranteed memoized. Keeps the per-step cost of building a `provides()` chain O(1).
   */
  private static withMemoizedFactories<S>(factories: Factories<S>): Container<S> {
    const c = Object.create(Container.prototype) as Container<S>;
    (c as { factories: Factories<S> }).factories = factories;
    return c;
  }

  // this is public on purpose; if the field is declared as private generated *.d.ts files do not include the field type
  // which makes typescript compiler behave differently when resolving container types; e.g. it becomes impossible to
  // assign a container of type Container<{ a: number, b: string }> to a variable of type Container<{ a: number }>.
  readonly factories: Readonly<Factories<Services>>;

  constructor(factories: MaybeMemoizedFactories<Services>) {
    // Public path: callers may hand us raw, non-memoized factories. Memoize any own keys
    // that aren't already memoized, preserving any prototype chain so inherited memoized
    // factories stay reachable. Internal builders use {@link withMemoizedFactories} above
    // to skip this scan entirely.
    const ownKeys = Object.keys(factories);
    const proto = Object.getPrototypeOf(factories);
    const memoizedFactories = (
      proto && proto !== Object.prototype ? Object.create(proto) : ({} as Factories<Services>)
    ) as Factories<Services>;
    for (const k of ownKeys) {
      const fn = (factories as any)[k];
      (memoizedFactories as any)[k] = isMemoized(fn) ? fn : memoize(fn);
    }
    this.factories = memoizedFactories;
  }

  /**
   * Creates a copy of this Container, optionally scoping specified services to the new copy.
   * Unspecified services are shared between the original and copied containers,
   * while factory functions for scoped services are re-invoked upon service resolution in the new container.
   *
   * This can be useful, for example, if different parts of an application wish to use the same Service interface,
   * but do not want to share a reference to same Service instance.
   *
   * Consider an example where we have a `UserListService` that manages a list of users.
   * If our application needs to display two user lists that can be edited independently
   * (e.g., in separate components or pages), it would be beneficial to create a distinct Container
   * for each list component. By scoping the `UserListService` to each Container,
   * we ensure that each component receives its own independent copy of the service.
   * This setup allows for independent edits to each user list without any overlap or
   * interference between the two components.
   *
   * @example
   * ```ts
   * // Create the original container and provide the UserListService
   * const originalContainer = Container.providesClass('UserListService', UserListService);
   *
   * // Create a new Container copy with UserListService scoped, allowing for independent user lists
   * const newListContainer = originalContainer.copy(['UserListService']);
   *
   * // Each Container now manages its own independent UserListService service instance
   * ```
   *
   * @param scopedServices An optional list of tokens for Services to be scoped to the new Container copy. Services
   * not specified will be shared with the original Container, while specified ones will be re-instantiated in the
   * new Container.
   * @returns A new Container copy that shares the original's services, with specified services scoped as unique
   * instances to the new Container.
   */
  copy<Tokens extends readonly (keyof Services)[]>(scopedServices?: Tokens): Container<Services> {
    if (!scopedServices || scopedServices.length === 0) {
      // Share factories via prototype chain — the new container resolves to the same memoized
      // instances as the original.
      return Container.withMemoizedFactories(Object.create(this.factories) as Factories<Services>);
    }
    // Override scoped tokens with freshly-memoized copies of the original delegates so the new
    // container produces independent service instances for those tokens.
    const factories = Object.create(this.factories) as Factories<Services>;
    for (const token of scopedServices) {
      factories[token] = memoize(this.factories[token].delegate);
    }
    return Container.withMemoizedFactories(factories);
  }

  /**
   * Retrieves a reference to this Container.
   *
   * @param token The {@link CONTAINER} token.
   * @returns This Container.
   */
  get(token: ContainerToken): this;

  /**
   * Retrieves a Service from the Container by its token.
   * On first request, the service's factory function is invoked and the result is memoized for future requests,
   * ensuring singleton behavior.
   *
   * @param token A unique token corresponding to a Service
   * @returns A Service corresponding to the given Token.
   */
  get<Token extends keyof Services>(token: Token): Services[Token];

  get(token: ContainerToken | keyof Services): this | Services[keyof Services] {
    if (token === CONTAINER) return this;
    const factory = this.factories[token];
    if (!factory) {
      throw new Error(
        `[Container::get] Could not find Service for Token "${String(token)}". This should've caused a ` +
          "compile-time error. If the Token is 'undefined', check all your calls to the Injectable " +
          "function. Make sure you define dependencies using string literals or string constants that are " +
          "definitely initialized before the call to Injectable."
      );
    }
    // Pass `this` so factories that depend on other services resolve them through the calling
    // container — supporting overrides applied after the factory was registered.
    return factory.call(this);
  }

  /**
   * Runs the factory functions for all services listed in the provided {@link PartialContainer},
   * along with their dependencies that are registered within *this* container.
   *
   * This method is particularly useful for preemptively initializing services that require setup before use.
   * It ensures that services are ready when needed without waiting for a lazy instantiation.
   *
   * **Note**: This method does not add new services to the container.
   *
   * @example
   * ```ts
   * // Create initializers for caching and reporting setup that depend on a request service
   * const initializers = new PartialContainer({})
   *   .provides("initCache", ["request"] as const, (request: Request) => fetchAndPopulateCache(request))
   *   .provides("setupReporter", ["request"] as const, (request: Request) => setupReporter(request));
   *
   * // Setup the main container with a request service and run the initializers
   * const container = Container
   *   .providesValue("request", (url: string) => fetch(url))
   *   .run(initializers);
   *
   * // At this point, `initCache` and `setupReporter` have been executed using the `request` service.
   * // And the `request` service itself has also been initialized within the `container`.
   * ```
   * @param container The {@link PartialContainer} specifying which services to initialize.
   * @returns The current container unchanged, with dependencies of the services listed
   * in the provided {@link PartialContainer} initialized as needed.
   */
  run<AdditionalServices, Dependencies, FulfilledDependencies extends Dependencies>(
    // FullfilledDependencies is assignable to Dependencies -- by specifying Container<FulfilledDependencies> as the
    // `this` type, we ensure this Container can provide all the Dependencies required by the PartialContainer.
    this: Container<FulfilledDependencies>,
    container: PartialContainer<AdditionalServices, Dependencies>
  ): this;

  /**
   * Runs the factory function for a specified service provided by {@link InjectableFunction},
   * along with its dependencies that are registered within *this* container.
   *
   * This method is particularly useful for services that need to be set up before they are used. It ensures that
   * the service is ready when needed, without relying on lazy instantiation.
   *
   * **Note**: This method does not add new services to the container.
   *
   * @example
   * ```ts
   * // Setup a container with a request service and directly run the `initCache` service
   * const container = Container
   *   .providesValue("request", (url: string) => fetch(url))
   *   .run(Injectable("initCache", ["request"], (request: Request) => fetchAndPopulateCache(request)));
   *
   * // At this point, `initCache` has been executed using the `request` service.
   * // And the `request` service itself has also been initialized.
   * ```
   *
   * @param fn The {@link InjectableFunction} specifying the service to initialize.
   * @returns The current container unchanged, with dependencies of the provided {@link InjectableFunction}
   * initialized as needed.
   */
  run<Token extends TokenType, Tokens extends readonly ValidTokens<Services>[], Service>(
    fn: InjectableFunction<Services, Tokens, Token, Service>
  ): this;

  run<Token extends TokenType, Tokens extends readonly ValidTokens<Services>[], Service, AdditionalServices>(
    fnOrContainer: InjectableFunction<Services, Tokens, Token, Service> | PartialContainer<AdditionalServices, Services>
  ): this {
    if (fnOrContainer instanceof PartialContainer) {
      const runnableContainer = this.provides(fnOrContainer);
      for (const token of fnOrContainer.getTokens()) {
        runnableContainer.get(token);
      }
    } else {
      this.provides(fnOrContainer).get(fnOrContainer.token);
    }
    return this;
  }

  /**
   * Merges additional services from a given `PartialContainer` into this container,
   * creating a new `Container` instance. Services defined in the `PartialContainer` take precedence
   * in the event of token conflicts, meaning any service in the `PartialContainer` with the same token
   * as one in this container will override the existing service.
   *
   * If the same `PartialContainer` is provided to multiple containers, each resulting container will have its own
   * independent instance of the services defined in the `PartialContainer`, ensuring no shared state between them.
   *
   * @param container The `PartialContainer` that provides the additional services to be merged into this container.
   *                  This container defines services and their dependencies that are to be integrated.
   * @returns A new `Container` instance that combines the services of this container with those from the provided
   *          `PartialContainer`, with services from the `PartialContainer` taking precedence in case of conflicts.
   */
  provides<AdditionalServices, Dependencies, FulfilledDependencies extends Dependencies>(
    // FullfilledDependencies is assignable to Dependencies -- by specifying Container<FulfilledDependencies> as the
    // `this` type, we ensure this Container can provide all the Dependencies required by the PartialContainer.
    this: Container<FulfilledDependencies>,
    container: PartialContainer<AdditionalServices, Dependencies>
  ): Container<AddServices<Services, AdditionalServices>>;

  /**
   * Merges services from another `Container` into this container, creating a new `Container` instance.
   * Services from the provided `Container` take precedence in the event of token conflicts.
   *
   * Importantly, services from the provided `Container` are shared between the original (source) container
   * and the new (destination) container created by this method. This means that both containers will reference
   * the same service instances, ensuring consistency but not isolation.
   *
   * If isolation is required (i.e., separate instances of the services in different containers), the source
   * container should be copied before being passed to this method. This ensures that new instances of the
   * services are created in the new container, avoiding shared state issues.
   *
   * @param container The `Container` that provides the additional services to be merged.
   * @returns A new `Container` instance that combines services from this container with those from the
   *          provided container, with services from the provided container taking precedence in case of conflicts.
   */
  provides<AdditionalServices>(
    container: Container<AdditionalServices>
  ): Container<AddServices<Services, AdditionalServices>>;

  /**
   * Registers a new service in this Container using a pre-built `InjectableFunction`.
   *
   * **Tip:** Prefer the inline forms `provides('token', () => value)` or
   * `provides('token', ['dep'] as const, (dep) => value)` instead.
   * Use this overload when you have a reusable `InjectableFunction` object.
   *
   * @param fn The `InjectableFunction` that constructs the service.
   * @returns A new `Container` instance containing the added service, allowing chaining of multiple `provides` calls.
   */
  provides<Token extends TokenType, Tokens extends readonly ValidTokens<Services>[], Service>(
    fn: InjectableFunction<Services, Tokens, Token, Service>
  ): Container<AddService<Services, Token, Service>>;

  /**
   * Registers a new service using a zero-argument factory function.
   * The factory is called lazily on first retrieval and the result is memoized.
   *
   * @example
   * ```ts
   * const container = Container
   *   .providesValue('config', { port: 3000 })
   *   .provides('Logger', () => new Logger())
   * ```
   *
   * @param token A unique Token identifying the service.
   * @param fn A zero-argument factory function that creates the service.
   * @returns A new Container with the service registered.
   */
  provides<Token extends TokenType, Service>(
    token: Token,
    fn: () => Service
  ): Container<AddService<Services, Token, Service>>;

  /**
   * Registers a new service using a factory function with dependencies.
   * Dependencies are specified as tokens and resolved from the container when the factory is called.
   *
   * @example
   * ```ts
   * const container = Container
   *   .providesValue('config', { port: 3000 })
   *   .provides('Server', ['config'] as const, (config: Config) => new Server(config))
   * ```
   *
   * @param token A unique Token identifying the service.
   * @param dependencies A readonly array of tokens for the factory's dependencies.
   * @param fn A factory function whose parameters match the resolved dependency types.
   * @returns A new Container with the service registered.
   */
  provides<Token extends TokenType, const Tokens extends readonly ValidTokens<Services>[], Service>(
    token: Token,
    dependencies: Tokens,
    fn: (...args: CorrespondingServices<Services, Tokens> extends infer T extends readonly any[] ? T : never) => Service
  ): Container<AddService<Services, Token, Service>>;

  provides(first: any, second?: any, third?: any): Container<any> {
    // Two-arg form: provides(token, factory)
    if (typeof second === "function") {
      return this.providesService(Injectable(first, second));
    }
    // Three-arg form: provides(token, dependencies, factory)
    if (Array.isArray(second) && typeof third === "function") {
      return this.providesService(Injectable(first, second, third) as any);
    }
    // Original single-arg forms
    if (first instanceof PartialContainer || first instanceof Container) {
      const incoming = first instanceof PartialContainer ? first.getFactories(this) : first.factories;
      // Layer the incoming factories on top of this.factories via prototype chain — O(1) base
      // plus O(K) for K incoming keys (instead of spreading every factory in `this`).
      const factories = Object.create(this.factories) as Factories<AddServices<Services, any>>;
      // `chainedForEach` walks own + inherited keys with their declared-at-level values in
      // a single pass, avoiding the O(N²) cost of `for...in` + `[k]` lookup on deep chains.
      chainedForEach(incoming, (k, v) => {
        (factories as any)[k] = v;
      });
      return Container.withMemoizedFactories(factories);
    }
    return this.providesService(first);
  }

  /**
   * Registers a service in the container using a class constructor, simplifying the service creation process.
   *
   * This method is particularly useful when the service creation logic can be encapsulated within a class
   * constructor.
   *
   * @param token A unique Token used to identify and retrieve the service from the container.
   * @param cls A class with a constructor that takes dependencies as arguments and a static `dependencies` field
   *            specifying these dependencies.
   * @returns A new Container instance containing the newly created service, allowing for method chaining.
   */
  providesClass<Token extends TokenType, Service, Tokens extends readonly ValidTokens<Services>[]>(
    token: Token,
    cls: InjectableClass<Services, Service, Tokens>
  ): Container<AddService<Services, Token, Service>> {
    return this.providesService(ClassInjectable(token, cls)) as Container<AddService<Services, Token, Service>>;
  }

  /**
   * Registers a static value as a service in the container. This method is ideal for services that do not
   * require dynamic instantiation and can be provided directly as they are.
   *
   * @param token A unique Token used to identify and retrieve the service from the container.
   * @param value The actual value to register as a service. This could be anything from a simple data object,
   *              a configuration, or a pre-instantiated service object.
   * @returns A new Container instance that includes the provided service, allowing for chaining additional
   *          `provides` calls.
   */
  providesValue<Token extends TokenType, Service>(
    token: Token,
    value: Service
  ): Container<AddService<Services, Token, Service>> {
    return this.providesService(Injectable(token, [], () => value));
  }

  /**
   * Appends a value to the array associated with a specified token in the current Container, then returns
   * the new Container with the updated value. This method is applicable under the following conditions:
   *  1. The Container already contains an array associated with the given token.
   *  2. The type of the items in the array matches the type of the value being appended.
   *
   * ```ts
   * const container = Container.fromObject({ services: [1, 2, 3] as number[] });
   * const newContainer = container.appendValue('services', 4);
   * console.log(newContainer.get('services')); // prints [1, 2, 3, 4];
   * ```
   *
   * @param token - A unique Token which will correspond to the previously defined typed array.
   * @param value - A value to append to the array.
   * @returns The updated Container with the appended value in the specified array.
   */
  appendValue<Token extends keyof Services, Service extends ArrayElement<Services[Token]>>(
    token: Token,
    value: Service
  ): Container<Services> {
    return this.providesService(ConcatInjectable(token, () => value)) as Container<Services>;
  }

  /**
   * Appends an injectable class factory to the array associated with a specified token in the current Container,
   * then returns the new Container with the updated value. This method is applicable under the following conditions:
   *  1. The Container already contains an array associated with the given token.
   *  2. The type of the items in the array matches the type of the value being appended.
   *
   * ```ts
   * const container = Container.fromObject({ services: [] as Service[] });
   * const newContainer = container.appendClass('services', Service);
   * console.log(newContainer.get('services').length); // prints 1;
   *
   * @param token - A unique Token which will correspond to the previously defined typed array.
   * @param cls - A class with a constructor that takes dependencies as arguments, which returns the Service.
   * @returns The updated Container with the new service instance appended to the specified array.
   */
  appendClass<
    Token extends keyof Services,
    Tokens extends readonly ValidTokens<Services>[],
    Service extends ArrayElement<Services[Token]>,
  >(token: Token, cls: InjectableClass<Services, Service, Tokens>): Container<Services> {
    return this.providesService(
      ConcatInjectable(token, () => this.providesClass(token, cls).get(token))
    ) as Container<Services>;
  }

  /**
   * Appends a new service instance to an existing array within the container using a zero-argument factory function.
   *
   * @example
   * ```ts
   * const container = Container.fromObject({ services: [] as Service[] });
   * const newContainer = container.append('services', () => new Service());
   * ```
   *
   * @param token A unique Token corresponding to the previously defined typed array.
   * @param fn A zero-argument factory function that returns the service to append.
   * @returns The updated Container with the new service instance appended.
   */
  append<Token extends keyof Services, Service extends ArrayElement<Services[Token]>>(
    token: Token,
    fn: () => Service
  ): Container<Services>;

  /**
   * Appends a new service instance to an existing array within the container using a factory function
   * with dependencies.
   *
   * @example
   * ```ts
   * const container = Container
   *   .providesValue('config', { url: '...' })
   *   .providesValue('services', [] as Service[])
   *   .append('services', ['config'] as const, (config: Config) => new Service(config));
   * ```
   *
   * @param token A unique Token corresponding to the previously defined typed array.
   * @param dependencies A readonly array of tokens for the factory's dependencies.
   * @param fn A factory function whose parameters match the resolved dependency types.
   * @returns The updated Container with the new service instance appended.
   */
  append<
    Token extends keyof Services,
    const Tokens extends readonly ValidTokens<Services>[],
    Service extends ArrayElement<Services[Token]>,
  >(
    token: Token,
    dependencies: Tokens,
    fn: (...args: CorrespondingServices<Services, Tokens> extends infer T extends readonly any[] ? T : never) => Service
  ): Container<Services>;

  /**
   * Appends a new service instance to an existing array using a pre-built `InjectableFunction`.
   *
   * **Tip:** Prefer `append('token', () => value)` or `append('token', ['dep'] as const, fn)` instead.
   *
   * @param fn - An injectable function that returns the Service.
   * @returns The updated Container with the new service instance appended.
   */
  append<
    Token extends keyof Services,
    Tokens extends readonly ValidTokens<Services>[],
    Service extends ArrayElement<Services[Token]>,
  >(fn: InjectableFunction<Services, Tokens, Token, Service>): Container<Services>;

  append(first: any, second?: any, third?: any): Container<Services> {
    let token: any;
    let fn: any;
    if (typeof second === "function") {
      // Two-arg form: append(token, factory)
      token = first;
      fn = Injectable(first as string, second);
    } else if (Array.isArray(second) && typeof third === "function") {
      // Three-arg form: append(token, dependencies, factory)
      token = first;
      fn = Injectable(first as string, second, third);
    } else {
      // Original single-arg form
      token = first.token;
      fn = first;
    }
    return this.providesService(
      ConcatInjectable(token, () => this.providesService(fn as any).get(token))
    ) as Container<Services>;
  }

  private providesService<
    Token extends TokenType,
    Tokens extends readonly ValidTokens<Services>[],
    Service,
    Dependencies,
  >(fn: InjectableFunction<Dependencies, Tokens, Token, Service>): Container<AddService<Services, Token, Service>> {
    const token = fn.token;
    const dependencies: readonly any[] = fn.dependencies;
    // If the service depends on itself, e.g. in the multi-binding case, where we call append multiple times with
    // the same token, we always must resolve the dependency using the parent container to avoid infinite loop.
    const getFromParent = dependencies.indexOf(token) === -1 ? undefined : () => this.get(token as any);
    const factory = memoize(function (this: Container<Services>) {
      // Safety: getFromParent is defined if the token is in the dependencies list, so it is safe to call it.
      return fn(...(dependencies.map((t) => (t === token ? getFromParent!() : this.get(t))) as any));
    });
    // Extend `this.factories` via prototype chain so adding a service is O(1) — a chain of N
    // `provides` calls is O(N) total instead of O(N²).
    const factories = Object.create(this.factories) as Factories<AddService<Services, Token, Service>>;
    (factories as any)[token] = factory;
    return Container.withMemoizedFactories(factories);
  }
}
