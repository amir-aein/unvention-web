(function attachLogLevels(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  root.LOG_LEVELS = ["info", "warn", "error", "debug"];
})(typeof window !== "undefined" ? window : globalThis);
