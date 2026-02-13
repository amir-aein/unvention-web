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
        phase: "roll_and_group_dice",
        gameStatus: "active",
        players: [],
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
      return merged;
    }
  }

  root.GameStateService = GameStateService;
})(typeof window !== "undefined" ? window : globalThis);
