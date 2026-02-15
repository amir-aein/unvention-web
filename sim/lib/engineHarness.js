const path = require('node:path');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureRoundEngineLoaded() {
  if (!globalThis.Unvention || !globalThis.Unvention.RoundEngineService) {
    const modulePath = path.resolve(__dirname, '../../src/core/services/roundEngineService.js');
    require(modulePath);
  }
  return globalThis.Unvention.RoundEngineService;
}

function createBaseState() {
  return {
    version: 1,
    currentDay: 'Friday',
    turnNumber: 1,
    phase: 'roll_and_group',
    gameStatus: 'active',
    gameStarted: true,
    activePlayerId: 'P1',
    gameConfig: {
      journalCount: 3,
      workshopCount: 4,
      ruleset: null,
      modId: 'classic',
      setupSteps: [],
    },
    players: [],
    rngSeed: 'default-seed',
    rngState: 3288473048,
    journalSelections: {},
    workshopSelections: {},
    workshopPhaseContext: {},
    buildDrafts: {},
    buildDecisions: {},
    setupPlan: null,
    turnToolUsage: {},
    inventTransforms: {},
    toolUnlockRegistry: {},
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

function createHarness(options = {}) {
  const RoundEngineService = ensureRoundEngineLoaded();
  const logs = [];
  let state = {
    ...createBaseState(),
    ...(options.state || {}),
  };

  const gameStateService = {
    getState() {
      return deepClone(state);
    },
    update(partial) {
      state = { ...state, ...partial };
      return this.getState();
    },
    setState(nextState) {
      state = { ...createBaseState(), ...(nextState || {}) };
      return this.getState();
    },
    reset() {
      state = createBaseState();
      return this.getState();
    },
  };

  const loggerService = {
    logEvent(level, message, context) {
      logs.push({
        level,
        message,
        context: context || {},
      });
    },
  };

  const engine = new RoundEngineService(gameStateService, loggerService, options.diceRoller);
  return {
    engine,
    logs,
    getState: () => gameStateService.getState(),
  };
}

function createConfiguredHarness(config = {}) {
  const harness = createHarness({
    state: config.state,
    diceRoller: config.diceRoller,
  });

  const playerIds = Array.isArray(config.playerIds) ? config.playerIds : ['P1'];
  if (config.seed) {
    harness.engine.setSeed(config.seed);
  }
  if (playerIds.length > 0) {
    harness.engine.initializePlayers(playerIds);
  }

  return harness;
}

function cloneHarnessFromState(state) {
  return createHarness({ state: deepClone(state) });
}

module.exports = {
  deepClone,
  createHarness,
  createConfiguredHarness,
  cloneHarnessFromState,
};
