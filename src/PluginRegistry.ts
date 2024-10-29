/**
 * A type representing a function that observes a plugin.
 *
 * @template PluginInterface - The interface that the plugin implements.
 * @param plugin - The plugin instance that is being observed.
 */
export type PluginObserver<PluginInterface> = (plugin: PluginInterface) => void;

/**
 * A registry for managing plugins and notifying observers about new plugins.
 *
 * This class allows you to register plugins and observe when new plugins are added.
 * It maintains a list of plugins and notifies all registered observers whenever a new plugin is added.
 *
 * @template PluginInterface - The interface that all plugins must implement.
 *
 * @example
 * // Define a plugin interface
 * interface MyPlugin {
 *   doSomething(): void;
 * }
 *
 * // Create a plugin registry for MyPlugin
 * const registry = new PluginRegistry<MyPlugin>();
 *
 * // Define a plugin that implements MyPlugin
 * const plugin: MyPlugin = {
 *   doSomething() {
 *     console.log('Plugin is doing something');
 *   }
 * };
 *
 * // Define an observer
 * const observer: PluginObserver<MyPlugin> = (plugin) => {
 *   console.log('New plugin registered:', plugin);
 * };
 *
 * // Register the observer
 * registry.observe(observer);
 *
 * // Register the plugin
 * registry.register(plugin);
 * // Output:
 * // New plugin registered: { doSomething: [Function: doSomething] }
 * // Plugin is doing something
 */
export class PluginRegistry<PluginInterface> {
  private plugins: PluginInterface[] = [];
  private observers: PluginObserver<PluginInterface>[] = [];

  /**
   * Registers a new plugin and notifies all observers about the new plugin.
   *
   * @param plugin - The plugin to be registered, which implements the PluginInterface.
   */
  register(plugin: PluginInterface): void {
    this.plugins.push(plugin);
    this.observers.forEach((observer) => observer(plugin));
  }

  /**
   * Registers an observer to the plugin registry.
   *
   * @param observer - The observer that will be called when a new plugin is registered.
   */
  observe(observer: PluginObserver<PluginInterface>): void {
    this.observers.push(observer);
  }

  /**
   * Retrieves the list of registered plugins.
   *
   * @returns {PluginInterface[]} An array of plugins registered with the registry.
   */
  getPlugins(): PluginInterface[] {
    return this.plugins;
  }
}
