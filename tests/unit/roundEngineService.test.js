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
    phase: 'journal',
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
  const harness = createHarness({}, () => [1, 3, 5, 5, 6]);
  harness.engine.initializePlayers(['P1']);
  harness.engine.ensureJournalRoll();

  assert.equal(harness.getState().phase, 'journal');
  assert.equal(harness.getState().rollAndGroup.dice.length, 5);

  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 5);
  harness.engine.placeJournalNumber('P1', 0, 0);

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'workshop');

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'build');

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'invent');

  harness.engine.advancePhase();
  const afterTurn = harness.getState();
  assert.equal(afterTurn.phase, 'journal');
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
  assert.equal(state.phase, 'journal');
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
  harness.engine.ensureJournalRoll();
  const state = harness.getState();

  assert.equal(state.phase, 'journal');
  assert.equal(state.rollAndGroup.outcomeType, 'two_groups');
  assert.deepEqual(state.rollAndGroup.groups, [[5, 5], [1, 3, 6]]);
});

test('RoundEngineService detects three_groups roll pattern', () => {
  const harness = createHarness({}, () => [2, 3, 3, 4, 4]);
  harness.engine.ensureJournalRoll();
  const state = harness.getState();

  assert.equal(state.rollAndGroup.outcomeType, 'three_groups');
  assert.deepEqual(state.rollAndGroup.groups, [[3, 3], [4, 4], [2]]);
});

test('RoundEngineService detects eureka roll pattern', () => {
  const harness = createHarness({}, () => [1, 2, 3, 4, 6]);
  harness.engine.ensureJournalRoll();
  const state = harness.getState();

  assert.equal(state.rollAndGroup.outcomeType, 'eureka');
  assert.deepEqual(state.rollAndGroup.groups, []);
});

test('RoundEngineService detects quantum leap roll pattern', () => {
  const harness = createHarness({}, () => [4, 4, 4, 4, 4]);
  harness.engine.ensureJournalRoll();
  const state = harness.getState();

  assert.equal(state.rollAndGroup.outcomeType, 'quantum_leap');
  assert.deepEqual(state.rollAndGroup.groups, []);
});

test('RoundEngineService produces deterministic rolls from seed', () => {
  const harnessA = createHarness();
  harnessA.engine.setSeed('alpha-seed');
  harnessA.engine.ensureJournalRoll();
  const firstRollA = harnessA.getState().rollAndGroup.dice;

  const harnessB = createHarness();
  harnessB.engine.setSeed('alpha-seed');
  harnessB.engine.ensureJournalRoll();
  const firstRollB = harnessB.getState().rollAndGroup.dice;

  assert.deepEqual(firstRollA, firstRollB);
});

test('RoundEngineService initializes players with default journals', () => {
  const harness = createHarness();
  harness.engine.initializePlayers(['P1']);
  const state = harness.getState();
  const p1 = state.players.find((player) => player.id === 'P1');

  assert.ok(p1);
  assert.equal(p1.journals.length, 3);
  assert.equal(p1.journals[0].size, 4);
  assert.equal(p1.journals[0].grid.length, 4);
  assert.equal(p1.journals[0].grid[0].length, 4);
  assert.deepEqual(p1.journals[0].rowWrenches, ['available', 'available', 'available', 'available']);
  assert.deepEqual(p1.journals[0].columnWrenches, ['available', 'available', 'available', 'available']);
  assert.equal(p1.journals[0].ideaStatus, 'available');
  assert.equal(p1.journals[0].completionStatus, 'incomplete');
});

test('RoundEngineService requires journaling selection and placement before phase ends', () => {
  const harness = createHarness({}, () => [1, 3, 5, 5, 6]);
  harness.engine.initializePlayers(['P1']);
  harness.engine.ensureJournalRoll();
  assert.equal(harness.getState().phase, 'journal');

  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'journal');

  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 5);
  harness.engine.placeJournalNumber('P1', 0, 0);
  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'workshop');
});

test('RoundEngineService blocks illegal journal placement conflicts', () => {
  const harness = createHarness({}, () => [1, 3, 5, 5, 6]);
  harness.engine.initializePlayers(['P1']);
  harness.engine.ensureJournalRoll();
  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 5);
  const placed = harness.engine.placeJournalNumber('P1', 0, 0);
  assert.equal(placed.ok, true);

  harness.engine.selectActiveJournalNumber('P1', 5);
  const blocked = harness.engine.placeJournalNumber('P1', 0, 1);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'row_conflict');
});

test('RoundEngineService locks journaling group and journal after journal selection', () => {
  const harness = createHarness({}, () => [1, 3, 5, 5, 6]);
  harness.engine.initializePlayers(['P1']);
  harness.engine.ensureJournalRoll();
  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');

  harness.engine.selectJournalingGroup('P1', 'group-1');
  harness.engine.selectJournal('P1', 'J2');

  const selection = harness.getState().journalSelections.P1;
  assert.equal(selection.selectedGroupKey, 'group-0');
  assert.equal(selection.selectedJournalId, 'J1');
});

test('RoundEngineService awards row and column wrenches when completed', () => {
  const harness = createHarness({
    phase: 'journal',
    rollAndGroup: {
      dice: [1, 3, 5, 5, 6],
      outcomeType: 'two_groups',
      groups: [[5, 5], [1, 3, 6]],
      rolledAtTurn: 1,
      rolledAtDay: 'Friday',
    },
  });
  harness.engine.initializePlayers(['P1']);
  const state = harness.getState();
  const p1 = state.players.find((player) => player.id === 'P1');
  const journal = p1.journals.find((item) => item.id === 'J1');

  journal.grid[0] = [1, 2, 3, null];
  journal.grid[1][3] = 1;
  journal.grid[2][3] = 2;
  journal.grid[3][3] = 3;
  harness.engine.gameStateService.update({ players: state.players });

  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 5);
  harness.engine.placeJournalNumber('P1', 0, 3);

  const updated = harness.getState();
  const updatedJournal = updated.players.find((player) => player.id === 'P1').journals.find((j) => j.id === 'J1');

  assert.equal(updatedJournal.rowWrenches[0], 'earned');
  assert.equal(updatedJournal.columnWrenches[3], 'earned');
});

test('RoundEngineService blocks placement when no valid active number remains', () => {
  const harness = createHarness({
    phase: 'journal',
    rollAndGroup: {
      dice: [2, 2, 3, 3, 1],
      outcomeType: 'three_groups',
      groups: [[2, 2], [3, 3], [1]],
      rolledAtTurn: 1,
      rolledAtDay: 'Friday',
    },
  });
  harness.engine.initializePlayers(['P1']);
  harness.engine.selectJournalingGroup('P1', 'group-2');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 1);
  const firstPlacement = harness.engine.placeJournalNumber('P1', 0, 0);
  assert.equal(firstPlacement.ok, true);

  const secondPlacement = harness.engine.placeJournalNumber('P1', 0, 1);
  assert.equal(secondPlacement.ok, false);
  assert.equal(secondPlacement.reason, 'missing_number');
});

test('RoundEngineService stores cell metadata on journal placement', () => {
  const harness = createHarness({
    phase: 'journal',
    currentDay: 'Saturday',
    turnNumber: 3,
    rollAndGroup: {
      dice: [1, 3, 5, 5, 6],
      outcomeType: 'two_groups',
      groups: [[5, 5], [1, 3, 6]],
      rolledAtTurn: 3,
      rolledAtDay: 'Saturday',
    },
  });
  harness.engine.initializePlayers(['P1']);
  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 5);
  const result = harness.engine.placeJournalNumber('P1', 1, 1);
  assert.equal(result.ok, true);

  const state = harness.getState();
  const meta = state.players.find((player) => player.id === 'P1').journals.find((j) => j.id === 'J1').cellMeta[1][1];
  assert.equal(meta.placedAtTurn, 3);
  assert.equal(meta.placedAtDay, 'Saturday');
});

test('RoundEngineService excludes journaling group from workshop options', () => {
  const harness = createHarness({}, () => [1, 3, 5, 5, 6]);
  harness.engine.initializePlayers(['P1']);
  harness.engine.ensureJournalRoll();
  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 5);
  harness.engine.placeJournalNumber('P1', 0, 0);
  harness.engine.advancePhase();
  assert.equal(harness.getState().phase, 'workshop');

  const options = harness.engine.getWorkshoppingOptions('P1');
  assert.equal(options.length, 1);
  assert.equal(options[0].key, 'group-1');
});

test('RoundEngineService applies workshop selection per clicked part and locks workshop', () => {
  const harness = createHarness({}, () => [1, 3, 5, 5, 6]);
  harness.engine.initializePlayers(['P1']);
  harness.engine.ensureJournalRoll();
  harness.engine.selectJournalingGroup('P1', 'group-0');
  harness.engine.selectJournal('P1', 'J1');
  harness.engine.selectActiveJournalNumber('P1', 5);
  harness.engine.placeJournalNumber('P1', 0, 0);
  harness.engine.advancePhase();
  harness.engine.selectWorkshoppingGroup('P1', 'group-1');
  harness.engine.selectActiveWorkshopNumber('P1', 1);
  const result = harness.engine.placeWorkshopPart('P1', 'W2', 1, 0);
  assert.equal(result.ok, true);

  const locked = harness.engine.placeWorkshopPart('P1', 'W1', 4, 0);
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, 'workshop_locked');

  const state = harness.getState();
  const workshop = state.players
    .find((player) => player.id === 'P1')
    .workshops.find((item) => item.id === 'W2');
  const selection = state.workshopSelections.P1;
  assert.equal(workshop.partsByNumber['1'].circled, 1);
  assert.equal(selection.selectedWorkshopId, 'W2');
  assert.equal(selection.workshopLocked, true);
  assert.equal(workshop.partsByNumber['5'].circled, 0);
});
