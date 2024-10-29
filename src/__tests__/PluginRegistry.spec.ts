import { PluginRegistry } from "../PluginRegistry";

interface MockPluginInterface {
  mockMethod(): void;
}

describe("PluginRegistry", () => {
  let registry: PluginRegistry<MockPluginInterface>;
  let plugin: MockPluginInterface;
  let observer: jest.Mock;

  beforeEach(() => {
    registry = new PluginRegistry();
    plugin = {
      mockMethod: jest.fn(),
    };
    observer = jest.fn();
  });

  test("should register a plugin and notify observers", () => {
    registry.observe(observer);
    registry.register(plugin);

    expect(observer).toHaveBeenCalledWith(plugin);
    expect(observer).toHaveBeenCalledTimes(1);
  });

  test("should return the list of registered plugins", () => {
    registry.register(plugin);

    expect(registry.getPlugins()).toEqual([plugin]);
  });
});
