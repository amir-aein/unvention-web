(function attachContainer(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  function createContainer() {
    const loggerPort = new root.InMemoryLogger();
    const loggerService = new root.LoggerService(loggerPort);

    return {
      loggerService,
    };
  }

  root.createContainer = createContainer;
})(window);
