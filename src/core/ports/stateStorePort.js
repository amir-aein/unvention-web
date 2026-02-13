(function attachStateStorePortContract(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  // Documentation-only contract for app state storage adapters.
  root.stateStorePortContract = {
    loadState: "loadState() => object | null",
    saveState: "saveState(state) => void",
    clearState: "clearState() => void",
  };
})(typeof window !== "undefined" ? window : globalThis);
