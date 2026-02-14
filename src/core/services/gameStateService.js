(function attachGameStateService(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
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
      if (typeof merged.rngSeed !== "string" || merged.rngSeed.length === 0) {
        merged.rngSeed = defaults.rngSeed;
      }
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
