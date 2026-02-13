const test = require('node:test');
const assert = require('node:assert/strict');

function loadRoundEngineService() {
  delete globalThis.Unvention;
  delete require.cache[require.resolve('../../src/core/services/roundEngineService.js')];
  require('../../src/core/services/roundEngineService.js');
  return globalThis.Unvention.RoundEngineService;
}

function createHarness(initialState, diceRoller) {
  let state = {
    version: 1,
    currentDay: 'Friday',
    turnNumber: 1,
    phase: 'roll_and_group_dice',
    gameStatus: 'active',
    players: [],
    rngSeed: 'default-seed',
    rngState: 3288473048,
    rollAndGroup: {
      dice: [],
      outcomeType: null,
      groups: [],
      rolledAtTurn: null,
      rolledAtDay: null,
    },
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
    engine: new (loadRoundEngineService())(gameStateService, loggerService, diceRoller),
    getState: () => gameStateService.getState(),
    logs,
  };
}

test('RoundEngineService advances through standard phase order', () => {
  const harness = createHarness();

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'journal');
  assert.equal(harness.getState().rollAndGroup.dice.length, 5);

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

test('RoundEngineService detects two_groups roll pattern', () => {
  const harness = createHarness({}, () => [1, 3, 5, 5, 6]);
  harness.engine.advancePhase();
  const state = harness.getState();

  assert.equal(state.phase, 'journal');
  assert.equal(state.rollAndGroup.outcomeType, 'two_groups');
  assert.deepEqual(state.rollAndGroup.groups, [[5, 5], [1, 3, 6]]);
});

test('RoundEngineService detects three_groups roll pattern', () => {
  const harness = createHarness({}, () => [2, 3, 3, 4, 4]);
  harness.engine.advancePhase();
  const state = harness.getState();

  assert.equal(state.rollAndGroup.outcomeType, 'three_groups');
  assert.deepEqual(state.rollAndGroup.groups, [[3, 3], [4, 4], [2]]);
});

test('RoundEngineService detects eureka roll pattern', () => {
  const harness = createHarness({}, () => [1, 2, 3, 4, 6]);
  harness.engine.advancePhase();
  const state = harness.getState();

  assert.equal(state.rollAndGroup.outcomeType, 'eureka');
  assert.deepEqual(state.rollAndGroup.groups, []);
});

test('RoundEngineService detects quantum leap roll pattern', () => {
  const harness = createHarness({}, () => [4, 4, 4, 4, 4]);
  harness.engine.advancePhase();
  const state = harness.getState();

  assert.equal(state.rollAndGroup.outcomeType, 'quantum_leap');
  assert.deepEqual(state.rollAndGroup.groups, []);
});

test('RoundEngineService produces deterministic rolls from seed', () => {
  const harnessA = createHarness();
  harnessA.engine.setSeed('alpha-seed');
  harnessA.engine.advancePhase();
  const firstRollA = harnessA.getState().rollAndGroup.dice;

  const harnessB = createHarness();
  harnessB.engine.setSeed('alpha-seed');
  harnessB.engine.advancePhase();
  const firstRollB = harnessB.getState().rollAndGroup.dice;

  assert.deepEqual(firstRollA, firstRollB);
});
