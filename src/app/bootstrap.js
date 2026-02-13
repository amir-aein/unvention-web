(function bootstrap(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});
  const container = root.createContainer();
  const loggerService = container.loggerService;
  const gameStateService = container.gameStateService;
  const roundEngineService = container.roundEngineService;
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

  function renderState() {
    const state = roundEngineService.getState();
    const p1 = (state.players || []).find((player) => player.id === "P1");
    const rollState = state.rollAndGroup || {};
    const rollDisplay = Array.isArray(rollState.dice) && rollState.dice.length > 0
      ? rollState.dice.join(", ")
      : "-";
    const groupDisplay = Array.isArray(rollState.groups) && rollState.groups.length > 0
      ? rollState.groups.map((group) => "[" + group.join(", ") + "]").join(" ")
      : "-";

    document.getElementById("state-day").textContent = state.currentDay;
    document.getElementById("state-turn").textContent = String(state.turnNumber);
    document.getElementById("state-phase").textContent = state.phase;
    document.getElementById("state-status").textContent = state.gameStatus;
    document.getElementById("state-p1-journals").textContent = String(
      p1 ? p1.completedJournals : 0,
    );
    document.getElementById("state-last-roll").textContent = rollDisplay;
    document.getElementById("state-roll-outcome").textContent = rollState.outcomeType || "-";
    document.getElementById("state-roll-groups").textContent = groupDisplay;
    document.getElementById("state-seed").textContent = state.rngSeed || "default-seed";
  }

  document.getElementById("advance-phase").addEventListener("click", function onAdvancePhase() {
    roundEngineService.advancePhase();
    renderState();
  });

  document.getElementById("p1-add-journal").addEventListener("click", function onAddJournal() {
    const state = roundEngineService.getState();
    const p1 = (state.players || []).find((player) => player.id === "P1");
    const nextCount = Math.min(3, (p1 ? p1.completedJournals : 0) + 1);
    roundEngineService.updatePlayerJournalCompletion("P1", nextCount);
    renderState();
  });

  document.getElementById("set-seed").addEventListener("click", function onSetSeed() {
    const seedInput = document.getElementById("seed-input");
    const seedValue = seedInput.value;
    roundEngineService.setSeed(seedValue);
    renderState();
  });

  document.getElementById("reset-game").addEventListener("click", function onResetGame() {
    gameStateService.reset();
    loggerService.replaceEntries([]);
    loggerService.logEvent("warn", "Game reset to default state", { source: "ui" });
    const seedInput = document.getElementById("seed-input");
    seedInput.value = "";
    renderState();
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

  renderState();
})(typeof window !== "undefined" ? window : globalThis);
