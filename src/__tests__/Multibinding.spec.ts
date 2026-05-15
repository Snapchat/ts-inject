/* eslint-disable max-classes-per-file */
import { Container } from "../Container";
import { Injectable } from "../Injectable";
import { PartialContainer } from "../PartialContainer";
import { bind, compose } from "../Multibinding";
import type { Multibinding } from "../Multibinding";

interface Plugin {
  name: string;
  run(): string;
}

type Registry = {
  plugins: Plugin[];
  middlewares: ((req: string) => string)[];
};

describe("Multibinding", () => {
  describe("bind().contributeValue", () => {
    test("appends a literal value to a registry token", () => {
      const inline: Plugin = { name: "inline", run: () => "inline" };
      const binding = bind<Registry>().contributeValue("plugins", inline).build();

      const core = Container.providesValue("plugins", [] as Plugin[]);
      const result = compose(core, binding);

      expect(result.get("plugins")).toEqual([inline]);
    });

    test("multiple contributeValue calls preserve insertion order", () => {
      const a: Plugin = { name: "a", run: () => "a" };
      const b: Plugin = { name: "b", run: () => "b" };
      const binding = bind<Registry>()
        .contributeValue("plugins", a)
        .contributeValue("plugins", b)
        .build();

      const core = Container.providesValue("plugins", [] as Plugin[]);
      expect(compose(core, binding).get("plugins")).toEqual([a, b]);
    });
  });

  describe("bind().contributeClass", () => {
    test("instantiates the class with deps resolved from the core container", () => {
      class AuthPlugin implements Plugin {
        static dependencies = ["apiKey"] as const;
        readonly name = "auth";
        constructor(private apiKey: string) {}
        run() {
          return `auth:${this.apiKey}`;
        }
      }

      const binding = bind<Registry>().contributeClass("plugins", AuthPlugin).build();
      const core = Container.providesValue("apiKey", "secret").providesValue("plugins", [] as Plugin[]);
      const result = compose(core, binding);

      expect(result.get("plugins").map((p) => p.run())).toEqual(["auth:secret"]);
    });

    test("compose reports missing deps as a type error", () => {
      class NeedsConfig implements Plugin {
        static dependencies = ["config"] as const;
        readonly name = "needs-config";
        constructor(private config: { url: string }) {}
        run() {
          return this.config.url;
        }
      }

      const binding = bind<Registry>().contributeClass("plugins", NeedsConfig).build();
      const core = Container.providesValue("plugins", [] as Plugin[]);

      // @ts-expect-error: core does not provide "config"
      compose(core, binding);
    });
  });

  describe("bind().contribute(Injectable)", () => {
    test("appends a pre-built InjectableFunction, resolving its deps from the core", () => {
      const metricsPlugin = Injectable(
        "plugins",
        ["statsPrefix"] as const,
        (prefix: string): Plugin => ({ name: "metrics", run: () => `${prefix}.requests` })
      );

      const binding = bind<Registry>().contribute(metricsPlugin).build();
      const core = Container.providesValue("statsPrefix", "app").providesValue("plugins", [] as Plugin[]);

      expect(compose(core, binding).get("plugins").map((p) => p.run())).toEqual(["app.requests"]);
    });

    test("zero-dep Injectable", () => {
      const ping = Injectable("plugins", (): Plugin => ({ name: "ping", run: () => "pong" }));
      const binding = bind<Registry>().contribute(ping).build();
      const core = Container.providesValue("plugins", [] as Plugin[]);

      expect(compose(core, binding).get("plugins").map((p) => p.run())).toEqual(["pong"]);
    });
  });

  describe("bind().withInternal", () => {
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

      // `retryPolicy` is satisfied by the internal partial; `endpoint` and `maxRetries`
      // must come from the core container.
      const binding = bind<Registry>().withInternal(internal).contributeClass("plugins", HttpPlugin).build();
      const core = Container.providesValue("endpoint", "https://api.example.com")
        .providesValue("maxRetries", 3)
        .providesValue("plugins", [] as Plugin[]);

      expect(compose(core, binding).get("plugins").map((p) => p.run())).toEqual([
        "https://api.example.com#3",
      ]);
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
      const binding = bind<Registry>().withInternal(internal).contributeClass("plugins", HttpPlugin).build();

      const core = Container.providesValue("plugins", [] as Plugin[]);
      // @ts-expect-error: core is missing "maxRetries", which the internal partial needs
      compose(core, binding);
    });
  });

  describe("compose", () => {
    test("applies multibindings left-to-right against a shared registry", () => {
      const inline: Plugin = { name: "inline", run: () => "inline" };
      const first = bind<Registry>().contributeValue("plugins", inline).build();

      class Logging implements Plugin {
        static dependencies = ["label"] as const;
        readonly name = "logging";
        constructor(private label: string) {}
        run() {
          return `log:${this.label}`;
        }
      }
      const second = bind<Registry>().contributeClass("plugins", Logging).build();

      const core = Container.providesValue("label", "dev").providesValue("plugins", [] as Plugin[]);
      const result = compose(core, first, second);

      expect(result.get("plugins").map((p) => p.run())).toEqual(["inline", "log:dev"]);
    });

    test("returns a Container of the original Core type — internal services do not leak into types", () => {
      const internal = new PartialContainer({}).providesValue("secret", "hidden");
      const binding = bind<Registry>()
        .withInternal(internal)
        .contributeValue("plugins", { name: "x", run: () => "x" })
        .build();

      const core = Container.providesValue("plugins", [] as Plugin[]);
      const result = compose(core, binding);

      // `secret` is reachable at runtime via PartialContainer's merge, but not in the type.
      // @ts-expect-error: "secret" is not part of Core's service surface
      result.get("secret");
    });

    test("contributions to different array tokens compose independently", () => {
      const upper: (req: string) => string = (r) => r.toUpperCase();
      const trim: (req: string) => string = (r) => r.trim();

      const pluginBinding = bind<Registry>()
        .contributeValue("plugins", { name: "noop", run: () => "noop" })
        .build();
      const mwBinding = bind<Registry>()
        .contributeValue("middlewares", upper)
        .contributeValue("middlewares", trim)
        .build();

      const core = Container.providesValue("plugins", [] as Plugin[]).providesValue(
        "middlewares",
        [] as ((req: string) => string)[]
      );
      const result = compose(core, pluginBinding, mwBinding);

      expect(result.get("plugins")).toHaveLength(1);
      expect(result.get("middlewares").map((m) => m("  hi  "))).toEqual(["  HI  ", "hi"]);
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
      const binding: Multibinding<Registry, { base: unknown }> = bind<Registry>()
        .contributeClass("plugins", Counter)
        .build();

      const coreA = Container.providesValue("base", 10).providesValue("plugins", [] as Plugin[]);
      const coreB = Container.providesValue("base", 100).providesValue("plugins", [] as Plugin[]);

      expect(compose(coreA, binding).get("plugins")[0].run()).toBe("11");
      expect(compose(coreB, binding).get("plugins")[0].run()).toBe("101");
    });
  });

  describe("type-level guards", () => {
    test("contributeValue rejects non-array tokens", () => {
      type Bad = { single: Plugin };
      // @ts-expect-error: "single" is not an array-typed token
      bind<Bad>().contributeValue("single", { name: "x", run: () => "x" });
    });

    test("contributeValue rejects values whose type does not match the array element", () => {
      // @ts-expect-error: number is not assignable to Plugin
      bind<Registry>().contributeValue("plugins", 42);
    });
  });
});
