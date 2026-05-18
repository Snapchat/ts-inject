/* eslint-disable max-classes-per-file */
import { Container } from "../Container";
import { Injectable } from "../Injectable";
import { PartialContainer } from "../PartialContainer";
import { combine, compose, multibindings, withInternal } from "../Multibinding";
import type { Multibinding } from "../Multibinding";

interface Plugin {
  name: string;
  run(): string;
}

type Registry = {
  plugins: Plugin[];
  middlewares: ((req: string) => string)[];
};

const m = multibindings<Registry>();

describe("Multibinding", () => {
  describe("multibindings(...).contribute(token, value)", () => {
    test("appends a literal value to a registry token", () => {
      const inline: Plugin = { name: "inline", run: () => "inline" };
      const binding = m.contribute("plugins", inline);

      const core = Container.providesValue("plugins", [] as Plugin[]);
      expect(compose(core, binding).get("plugins")).toEqual([inline]);
    });

    test("compose preserves the order in which bindings are passed", () => {
      const a: Plugin = { name: "a", run: () => "a" };
      const b: Plugin = { name: "b", run: () => "b" };

      const core = Container.providesValue("plugins", [] as Plugin[]);
      expect(compose(core, m.contribute("plugins", a), m.contribute("plugins", b)).get("plugins")).toEqual([
        a,
        b,
      ]);
    });
  });

  describe("multibindings(...).contribute(token, class)", () => {
    test("instantiates the class with deps resolved from the core container", () => {
      class AuthPlugin implements Plugin {
        static dependencies = ["apiKey"] as const;
        readonly name = "auth";
        constructor(private apiKey: string) {}
        run() {
          return `auth:${this.apiKey}`;
        }
      }

      const binding = m.contribute("plugins", AuthPlugin);
      const core = Container.providesValue("apiKey", "secret").providesValue("plugins", [] as Plugin[]);

      expect(compose(core, binding).get("plugins").map((p) => p.run())).toEqual(["auth:secret"]);
    });

    test("compose reports missing class deps as a type error", () => {
      class NeedsConfig implements Plugin {
        static dependencies = ["config"] as const;
        readonly name = "needs-config";
        constructor(private config: { url: string }) {}
        run() {
          return this.config.url;
        }
      }

      const binding = m.contribute("plugins", NeedsConfig);
      const core = Container.providesValue("plugins", [] as Plugin[]);

      // @ts-expect-error: core does not provide "config"
      compose(core, binding);
    });
  });

  describe("multibindings(...).contribute(injectable)", () => {
    test("appends a pre-built InjectableFunction, resolving its deps from the core", () => {
      const metricsPlugin = Injectable(
        "plugins",
        ["statsPrefix"] as const,
        (prefix: string): Plugin => ({ name: "metrics", run: () => `${prefix}.requests` })
      );

      const binding = m.contribute(metricsPlugin);
      const core = Container.providesValue("statsPrefix", "app").providesValue("plugins", [] as Plugin[]);

      expect(compose(core, binding).get("plugins").map((p) => p.run())).toEqual(["app.requests"]);
    });

    test("zero-dep Injectable", () => {
      const ping = Injectable("plugins", (): Plugin => ({ name: "ping", run: () => "pong" }));
      const core = Container.providesValue("plugins", [] as Plugin[]);

      expect(compose(core, m.contribute(ping)).get("plugins").map((p) => p.run())).toEqual(["pong"]);
    });
  });

  describe("combine", () => {
    test("bundles several Multibindings into one, applied in order", () => {
      const inline: Plugin = { name: "inline", run: () => "inline" };

      class Logging implements Plugin {
        static dependencies = ["label"] as const;
        readonly name = "logging";
        constructor(private label: string) {}
        run() {
          return `log:${this.label}`;
        }
      }

      const bundle = combine(m.contribute("plugins", inline), m.contribute("plugins", Logging));

      const core = Container.providesValue("label", "dev").providesValue("plugins", [] as Plugin[]);
      expect(compose(core, bundle).get("plugins").map((p) => p.run())).toEqual(["inline", "log:dev"]);
    });

    test("combine() with no bindings is the identity", () => {
      const core = Container.providesValue("plugins", [] as Plugin[]);
      expect(compose(core, combine<Registry>()).get("plugins")).toEqual([]);
    });

    test("unions deps across bundled bindings", () => {
      class A implements Plugin {
        static dependencies = ["depA"] as const;
        readonly name = "a";
        constructor(private d: string) {}
        run() {
          return this.d;
        }
      }
      class B implements Plugin {
        static dependencies = ["depB"] as const;
        readonly name = "b";
        constructor(private d: string) {}
        run() {
          return this.d;
        }
      }

      const bundle = combine(m.contribute("plugins", A), m.contribute("plugins", B));
      const core = Container.providesValue("depA", "x").providesValue("plugins", [] as Plugin[]);

      // @ts-expect-error: bundle requires both depA and depB; core only has depA
      compose(core, bundle);
    });
  });

  describe("withInternal", () => {
    test("subtracts services provided by the partial from the required deps", () => {
      class HttpPlugin implements Plugin {
        static dependencies = ["retryPolicy", "endpoint"] as const;
        readonly name = "http";
        constructor(private retry: { tries: number }, private endpoint: string) {}
        run() {
          return `${this.endpoint}#${this.retry.tries}`;
        }
      }

      const internal = new PartialContainer({}).provides(
        "retryPolicy",
        ["maxRetries"] as const,
        (n: number) => ({ tries: n })
      );

      const binding = withInternal(internal, m.contribute("plugins", HttpPlugin));
      const core = Container.providesValue("endpoint", "https://api.example.com")
        .providesValue("maxRetries", 3)
        .providesValue("plugins", [] as Plugin[]);

      expect(compose(core, binding).get("plugins").map((p) => p.run())).toEqual([
        "https://api.example.com#3",
      ]);
    });

    test("internal services are visible to every binding inside the call, regardless of order", () => {
      class UsesRetry implements Plugin {
        static dependencies = ["retryPolicy"] as const;
        readonly name = "uses-retry";
        constructor(private retry: { tries: number }) {}
        run() {
          return `tries:${this.retry.tries}`;
        }
      }

      const internal = new PartialContainer({}).provides("retryPolicy", () => ({ tries: 5 }));

      const binding = withInternal(
        internal,
        m.contribute("plugins", UsesRetry),
        m.contribute("plugins", UsesRetry)
      );

      const core = Container.providesValue("plugins", [] as Plugin[]);
      expect(compose(core, binding).get("plugins").map((p) => p.run())).toEqual(["tries:5", "tries:5"]);
    });

    test("compose still flags unresolved internal dependencies", () => {
      class HttpPlugin implements Plugin {
        static dependencies = ["retryPolicy"] as const;
        readonly name = "http";
        constructor(private retry: { tries: number }) {}
        run() {
          return `tries:${this.retry.tries}`;
        }
      }
      const internal = new PartialContainer({}).provides(
        "retryPolicy",
        ["maxRetries"] as const,
        (n: number) => ({ tries: n })
      );
      const binding = withInternal(internal, m.contribute("plugins", HttpPlugin));

      const core = Container.providesValue("plugins", [] as Plugin[]);
      // @ts-expect-error: core is missing "maxRetries", which the internal partial needs
      compose(core, binding);
    });
  });

  describe("multibindings(registry) — runtime arg form", () => {
    test("binds S from a real Container without an explicit type argument", () => {
      const registry = Container.providesValue("plugins", [] as Plugin[]).providesValue(
        "middlewares",
        [] as ((req: string) => string)[]
      );
      const m2 = multibindings(registry);

      const inline: Plugin = { name: "inline", run: () => "inline" };
      class WithDep implements Plugin {
        static dependencies = ["token"] as const;
        readonly name = "wd";
        constructor(private t: string) {}
        run() {
          return this.t;
        }
      }
      const fromFactory = Injectable("plugins", (): Plugin => ({ name: "factory", run: () => "factory" }));

      const bundle = combine(
        m2.contribute("plugins", inline),
        m2.contribute("plugins", WithDep),
        m2.contribute(fromFactory)
      );

      const core = registry.providesValue("token", "tok");
      expect(compose(core, bundle).get("plugins").map((p) => p.name)).toEqual(["inline", "wd", "factory"]);
    });
  });

  describe("compose", () => {
    test("returns a Container of the original Core type — internal services do not leak into types", () => {
      const internal = new PartialContainer({}).providesValue("secret", "hidden");
      const binding = withInternal(internal, m.contribute("plugins", { name: "x", run: () => "x" }));

      const core = Container.providesValue("plugins", [] as Plugin[]);
      const result = compose(core, binding);

      // @ts-expect-error: "secret" is not part of Core's service surface
      result.get("secret");
    });

    test("contributions to different array tokens compose independently", () => {
      const upper: (req: string) => string = (r) => r.toUpperCase();
      const trim: (req: string) => string = (r) => r.trim();

      const core = Container.providesValue("plugins", [] as Plugin[]).providesValue(
        "middlewares",
        [] as ((req: string) => string)[]
      );

      const pluginBinding = m.contribute("plugins", { name: "noop", run: () => "noop" });
      const mwBindings = combine(m.contribute("middlewares", upper), m.contribute("middlewares", trim));

      const result = compose(core, pluginBinding, mwBindings);
      expect(result.get("plugins")).toHaveLength(1);
      expect(result.get("middlewares").map((mw) => mw("  hi  "))).toEqual(["  HI  ", "hi"]);
    });

    test("the same binding can be applied to multiple cores", () => {
      class Counter implements Plugin {
        static dependencies = ["base"] as const;
        readonly name = "counter";
        constructor(private base: number) {}
        run() {
          return `${this.base + 1}`;
        }
      }
      const binding = m.contribute("plugins", Counter);

      const coreA = Container.providesValue("base", 10).providesValue("plugins", [] as Plugin[]);
      const coreB = Container.providesValue("base", 100).providesValue("plugins", [] as Plugin[]);

      expect(compose(coreA, binding).get("plugins")[0].run()).toBe("11");
      expect(compose(coreB, binding).get("plugins")[0].run()).toBe("101");
    });
  });

  describe("type-level guards", () => {
    test("contribute rejects non-array tokens", () => {
      type Bad = { single: Plugin };
      const bad = multibindings<Bad>();
      // @ts-expect-error: "single" is not an array-typed token
      bad.contribute("single", { name: "x", run: () => "x" });
    });

    test("contribute rejects values whose type does not match the array element", () => {
      // @ts-expect-error: number is not assignable to Plugin
      m.contribute("plugins", 42);
    });

    test("Multibinding<S, D> can be written down explicitly", () => {
      class WithBase implements Plugin {
        static dependencies = ["base"] as const;
        readonly name = "with-base";
        constructor(private b: number) {}
        run() {
          return `${this.b}`;
        }
      }
      // The annotation should not widen D beyond the binding's actual deps.
      const binding: Multibinding<Registry, { base: unknown }> = m.contribute("plugins", WithBase);
      expect(typeof binding).toBe("function");
    });
  });
});
