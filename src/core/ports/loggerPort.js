(function attachLoggerPortContract(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  // Documentation-only contract for logger adapters.
  root.loggerPortContract = {
    append: "append({ level, message, context, timestamp }) => entry",
    clear: "clear()",
    getEntries: "getEntries() => entry[]",
    subscribe: "subscribe(listener) => unsubscribe",
  };
})(typeof window !== "undefined" ? window : globalThis);
