(function bootstrap(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});
  const container = root.createContainer();
  const loggerService = container.loggerService;
  const gameStateService = container.gameStateService;
  const loadedState = gameStateService.load();

  if (loadedState.logs.length > 0) {
    loggerService.replaceEntries(loadedState.logs);
  }

  loggerService.subscribe(function persistLogs() {
    gameStateService.update({
      logs: loggerService.toSerializableEntries(),
    });
  });

  root.createLogSidebar(loggerService);

  document.getElementById("demo-info").addEventListener("click", function onInfo() {
    loggerService.logEvent("info", "Player explored a safe action", {
      playerId: "P1",
      phase: "setup",
    });
  });

  document.getElementById("demo-warn").addEventListener("click", function onWarn() {
    loggerService.logEvent("warn", "Player tried an out-of-order action", {
      playerId: "P1",
      phase: "turn",
    });
  });

  document.getElementById("demo-error").addEventListener("click", function onError() {
    loggerService.logEvent("error", "Action failed validation", {
      playerId: "P1",
      phase: "resolution",
    });
  });

  document.getElementById("reset-game").addEventListener("click", function onResetGame() {
    gameStateService.reset();
    loggerService.replaceEntries([]);
    loggerService.logEvent("warn", "Game reset to default state", { source: "ui" });
  });

  if (loadedState.logs.length === 0) {
    loggerService.logEvent("info", "Logging system initialized", { source: "system" });
    loggerService.logEvent("debug", "Layered architecture ready for game integration", {
      source: "system",
    });
  } else {
    loggerService.logEvent("info", "Previous session restored from local storage", {
      source: "system",
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
