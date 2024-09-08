import type { Container, ContainerToken } from "./Container";

export type AsTuple<T> = T extends readonly any[] ? T : never;

type CorrespondingService<Services, Token extends ValidTokens<Services>> = Token extends ContainerToken
  ? Container<Services>
  : Token extends keyof Services
    ? Services[Token]
    : never;

/**
 * Token type for associating services in a container, supporting strings, numbers, or symbols.
 */
export type TokenType = string | number | symbol;

/**
 * Given a Services object, the valid Tokens are simply the keys of that object or the special Container Token.
 */
export type ValidTokens<Services> = ContainerToken | keyof Services;

/**
 * Given Services, map from a list of Tokens to a list of Service types.
 */
export type CorrespondingServices<Services, Tokens extends readonly ValidTokens<Services>[]> = {
  [K in keyof Tokens]: Tokens[K] extends ValidTokens<Services> ? CorrespondingService<Services, Tokens[K]> : never;
};

/**
 * A valid InjectableFunction is one that can be successfully called, given some Services, to return a new Service. That
 * is, it must satisfy two conditions:
 *
 *   1. All the Tokens it specifies as dependencies are valid given the Services (i.e. they are either the Container
 *   Token or keys of the Services type).
 *   2. The function argument types correspond to the Services specified by the dependency Tokens.
 *
 * A InjectableFunction also includes its own key Token and dependency Tokens as metadata, so it may be resolved by
 * Container<Services> later.
 */
export type InjectableFunction<
  Services,
  Tokens,
  Token extends TokenType,
  Service,
> = Tokens extends readonly ValidTokens<Services>[]
  ? {
      (...args: AsTuple<CorrespondingServices<Services, Tokens>>): Service;
      token: Token;
      dependencies: Tokens;
    }
  : never;

export type InjectableClass<Services, Service, Tokens> = Tokens extends readonly ValidTokens<Services>[]
  ? ClassWithInjections<Services, Service, Tokens>
  : never;

export interface ClassWithInjections<Services, Service, Tokens extends readonly ValidTokens<Services>[]> {
  readonly dependencies: Tokens;
  new (...args: AsTuple<CorrespondingServices<Services, Tokens>>): Service;
}

export type AnyInjectable = InjectableFunction<any, readonly TokenType[], TokenType, any>;

export type ServicesFromInjectables<Injectables extends readonly AnyInjectable[]> = {
  [Name in Injectables[number]["token"]]: ReturnType<Extract<Injectables[number], { token: Name }>>;
};

/**
 * Add a Service with a Token to an existing set of Services.
 */
// Using a conditional type forces TS language services to evaluate the type -- so when showing e.g. type hints, we
// will see the mapped type instead of the AddService type alias. This produces better hints.
export type AddService<ParentServices, Token extends TokenType, Service> = ParentServices extends any
  ? // A mapped type produces better, more concise type hints than an intersection type.
    {
      [K in keyof ParentServices | Token]: K extends keyof ParentServices
        ? K extends Token
          ? Service
          : ParentServices[K]
        : Service;
    }
  : never;

/**
 * Same as AddService above, but is merging multiple services at once. Services types override those of the parent.
 */
// Using a conditional type forces TS language services to evaluate the type -- so when showing e.g. type hints, we
// will see the mapped type instead of the AddService type alias. This produces better hints.
export type AddServices<ParentServices, Services> = ParentServices extends any
  ? Services extends any
    ? {
        [K in keyof Services | keyof ParentServices]: K extends keyof Services
          ? Services[K]
          : K extends keyof ParentServices
            ? ParentServices[K]
            : never;
      }
    : never
  : never;

/**
 * Create an object type from two tuples of the same length. The first tuple contains the object keys and the
 * second contains the value types corresponding to those keys.
 *
 * Ex:
 * ```ts
 * type FooBar = ServicesFromTokenizedParams<['foo', 'bar'], [string, number]>
 * const foobar: FooBar = {foo: 'foo', bar: 1}
 * const badfoobar: FooBar = {foo: 1, bar: 'bar'} // any extra, missing, or mis-typed properties raise an error.
 * ```
 */
export type ServicesFromTokenizedParams<Tokens, Params> = Tokens extends readonly []
  ? Params extends readonly []
    ? {}
    : never
  : Tokens extends readonly [infer Token, ...infer RemainingTokens]
    ? Params extends readonly [infer Param, ...infer RemainingParams]
      ? Tokens["length"] extends Params["length"]
        ? Token extends ContainerToken
          ? Param extends Container<infer S>
            ? S & ServicesFromTokenizedParams<RemainingTokens, RemainingParams>
            : never
          : Token extends TokenType
            ? { [K in Token]: Param extends Container<infer S> ? S : Param } & ServicesFromTokenizedParams<
                RemainingTokens,
                RemainingParams
              >
            : never
        : never
      : never
    : never;
