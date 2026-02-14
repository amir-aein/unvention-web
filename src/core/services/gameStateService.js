(function attachGameStateService(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function normalizeCount(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
  }

  function normalizeGameConfig(input) {
    const candidate = input && typeof input === "object" ? input : {};
    const defaults = {
      journalCount: 3,
      workshopCount: 4,
    };
    const ruleset = candidate.ruleset && typeof candidate.ruleset === "object"
      ? JSON.parse(JSON.stringify(candidate.ruleset))
      : null;
    return {
      journalCount: normalizeCount(candidate.journalCount, defaults.journalCount, 1, 6),
      workshopCount: normalizeCount(candidate.workshopCount, defaults.workshopCount, 1, 4),
      ruleset,
    };
  }

  class GameStateService {
    constructor(stateStorePort) {
      this.stateStorePort = stateStorePort;
      this.state = this.getDefaultState();
    }

    load() {
      const loadedState = this.stateStorePort.loadState();
      if (!loadedState) {
        return this.getState();
      }

      this.state = this.mergeWithDefaults(loadedState);
      return this.getState();
    }

    persist() {
      this.stateStorePort.saveState(this.state);
    }

    getState() {
      return cloneState(this.state);
    }

    update(partialState) {
      this.state = this.mergeWithDefaults({ ...this.state, ...partialState });
      this.persist();
      return this.getState();
    }

    setState(nextState) {
      this.state = this.mergeWithDefaults(nextState || {});
      this.persist();
      return this.getState();
    }

    reset() {
      this.state = this.getDefaultState();
      this.persist();
      return this.getState();
    }

    getDefaultState() {
      return {
        version: 1,
        currentDay: "Friday",
        turnNumber: 1,
        phase: "roll_and_group",
        gameStatus: "active",
        gameStarted: false,
        activePlayerId: "P1",
        gameConfig: normalizeGameConfig(null),
        players: [],
        rngSeed: "default-seed",
        rngState: 3288473048,
        journalSelections: {},
        workshopSelections: {},
        workshopPhaseContext: {},
        buildDrafts: {},
        buildDecisions: {},
        undoHistory: [],
        rollAndGroup: {
          dice: [],
          outcomeType: null,
          groups: [],
          rolledAtTurn: null,
          rolledAtDay: null,
        },
        logs: [],
      };
    }

    mergeWithDefaults(candidate) {
      const defaults = this.getDefaultState();

      const merged = { ...defaults, ...candidate };
      if (!Array.isArray(merged.logs)) {
        merged.logs = [];
      }
      if (!Array.isArray(merged.players)) {
        merged.players = [];
      }
      if (typeof merged.gameStarted !== "boolean") {
        merged.gameStarted = merged.players.length > 0;
      }
      const playerIds = merged.players
        .map((player) => String(player?.id || "").trim())
        .filter(Boolean);
      if (typeof merged.activePlayerId !== "string" || !playerIds.includes(merged.activePlayerId)) {
        merged.activePlayerId = playerIds[0] || defaults.activePlayerId;
      }
      if (typeof merged.rngSeed !== "string" || merged.rngSeed.length === 0) {
        merged.rngSeed = defaults.rngSeed;
      }
      merged.gameConfig = normalizeGameConfig(merged.gameConfig);
      if (!Number.isInteger(merged.rngState)) {
        merged.rngState = defaults.rngState;
      }
      if (!merged.journalSelections || typeof merged.journalSelections !== "object") {
        merged.journalSelections = {};
      }
      if (!merged.workshopSelections || typeof merged.workshopSelections !== "object") {
        merged.workshopSelections = {};
      }
      if (!merged.workshopPhaseContext || typeof merged.workshopPhaseContext !== "object") {
        merged.workshopPhaseContext = {};
      }
      if (!merged.buildDrafts || typeof merged.buildDrafts !== "object") {
        merged.buildDrafts = {};
      }
      if (!merged.buildDecisions || typeof merged.buildDecisions !== "object") {
        merged.buildDecisions = {};
      }
      if (!Array.isArray(merged.undoHistory)) {
        merged.undoHistory = [];
      }
      if (!merged.rollAndGroup || typeof merged.rollAndGroup !== "object") {
        merged.rollAndGroup = defaults.rollAndGroup;
      }
      return merged;
    }
  }

  root.GameStateService = GameStateService;
})(typeof window !== "undefined" ? window : globalThis);
