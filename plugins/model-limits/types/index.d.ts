declare module 'claude-code' {
  interface PluginState {
    /** `lastPublishedAt`: when the file was last written, in `$.clock.now()` milliseconds; 0 until then. */
    'model-limits': { lastPublishedAt: number }
  }
}
