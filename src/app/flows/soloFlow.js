(function attachSoloFlow(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  root.createSoloFlow = function createSoloFlow(deps) {
    const documentRef = deps.documentRef;
    const undoStack = deps.undoStack;
    const gameStateService = deps.gameStateService;
    const persistUndoHistory = deps.persistUndoHistory;
    const loggerService = deps.loggerService;
    const roundEngineService = deps.roundEngineService;
    const generateRandomSeed = deps.generateRandomSeed;
    const renderState = deps.renderState;

    function startSoloGame() {
      const input = documentRef?.getElementById("new-game-seed");
      const desiredSeed = String(input?.value || "").trim() || generateRandomSeed();
      undoStack.length = 0;
      gameStateService.reset();
      persistUndoHistory();
      loggerService.replaceEntries([]);
      roundEngineService.initializePlayers(["P1"]);
      roundEngineService.setSeed(desiredSeed);
      gameStateService.update({ gameStarted: true });
      loggerService.logEvent("info", "New game started", { seed: desiredSeed, source: "ui" });
      renderState();
    }

    function bindLegacyStartButton() {
      const legacyStartNewGameButton = documentRef?.getElementById("start-new-game");
      if (!legacyStartNewGameButton) {
        return;
      }
      legacyStartNewGameButton.addEventListener("click", function onLegacyStartNewGame() {
        startSoloGame();
      });
    }

    return {
      startSoloGame,
      bindLegacyStartButton,
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
