(function attachContainer(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  function createContainer() {
    const loggerPort = new root.InMemoryLogger();
    const loggerService = new root.LoggerService(loggerPort);
    const storage = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    const stateStore = new root.LocalStorageStateStore(storage, "unvention.appState.v1");
    const gameStateService = new root.GameStateService(stateStore);
    const roundEngineService = new root.RoundEngineService(gameStateService, loggerService);

    return {
      gameStateService,
      loggerService,
      roundEngineService,
    };
  }

  root.createContainer = createContainer;
})(typeof window !== "undefined" ? window : globalThis);
