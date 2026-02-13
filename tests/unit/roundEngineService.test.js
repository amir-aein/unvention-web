const test = require('node:test');
const assert = require('node:assert/strict');

function loadRoundEngineService() {
  delete globalThis.Unvention;
  delete require.cache[require.resolve('../../src/core/services/roundEngineService.js')];
  require('../../src/core/services/roundEngineService.js');
  return globalThis.Unvention.RoundEngineService;
}

function createHarness(initialState) {
  let state = {
    version: 1,
    currentDay: 'Friday',
    turnNumber: 1,
    phase: 'roll_and_group_dice',
    gameStatus: 'active',
    players: [],
    logs: [],
    ...initialState,
  };

  const logs = [];

  const gameStateService = {
    getState() {
      return JSON.parse(JSON.stringify(state));
    },
    update(partial) {
      state = { ...state, ...partial };
      return this.getState();
    },
  };

  const loggerService = {
    logEvent(level, message, context) {
      logs.push({ level, message, context });
    },
  };

  return {
    engine: new (loadRoundEngineService())(gameStateService, loggerService),
    getState: () => gameStateService.getState(),
    logs,
  };
}

test('RoundEngineService advances through standard phase order', () => {
  const harness = createHarness();

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'journal');

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'workshop');

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'build');

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'invent');

  harness.engine.advancePhase();
  const afterTurn = harness.getState();
  assert.equal(afterTurn.phase, 'roll_and_group_dice');
  assert.equal(afterTurn.turnNumber, 2);
  assert.equal(afterTurn.currentDay, 'Friday');
});

test('RoundEngineService ends Friday and starts Saturday when threshold reached', () => {
  const harness = createHarness({
    phase: 'invent',
    players: [{ id: 'P1', completedJournals: 1 }],
  });

  harness.engine.advancePhase();
  const state = harness.getState();

  assert.equal(state.currentDay, 'Saturday');
  assert.equal(state.turnNumber, 2);
  assert.equal(state.phase, 'roll_and_group_dice');
  assert.equal(state.gameStatus, 'active');
});

test('RoundEngineService skips Saturday when Friday and Saturday trigger together', () => {
  const harness = createHarness({
    phase: 'invent',
    players: [{ id: 'P1', completedJournals: 2 }],
  });

  harness.engine.advancePhase();
  const state = harness.getState();

  assert.equal(state.currentDay, 'Sunday');
  assert.equal(state.gameStatus, 'active');
  assert.ok(harness.logs.some((entry) => entry.message === 'Day skipped due to simultaneous trigger'));
});

test('RoundEngineService completes game on Sunday threshold', () => {
  const harness = createHarness({
    currentDay: 'Sunday',
    phase: 'invent',
    players: [{ id: 'P1', completedJournals: 3 }],
  });

  harness.engine.advancePhase();
  const state = harness.getState();

  assert.equal(state.gameStatus, 'completed');
  assert.equal(state.currentDay, 'Sunday');
  assert.ok(harness.logs.some((entry) => entry.message === 'Game completed'));
});
