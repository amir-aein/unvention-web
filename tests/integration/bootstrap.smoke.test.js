const test = require('node:test');
const assert = require('node:assert/strict');

function resetBootstrapModule() {
  delete require.cache[require.resolve('../../src/app/bootstrap.js')];
}

test('bootstrap wires round controls and reset action', () => {
  resetBootstrapModule();

  const listeners = {};
  const loggerCalls = [];
  const loggerEntries = [];
  let resetCalled = false;
  const uiState = {
    day: '',
    turn: '',
    phase: '',
    status: '',
    p1: '',
    seed: '',
    seedInputValue: '',
  };

  globalThis.document = {
    getElementById(id) {
      if (id === 'state-day') {
        return { set textContent(value) { uiState.day = value; } };
      }
      if (id === 'state-turn') {
        return { set textContent(value) { uiState.turn = value; } };
      }
      if (id === 'state-phase') {
        return { set textContent(value) { uiState.phase = value; } };
      }
      if (id === 'state-status') {
        return { set textContent(value) { uiState.status = value; } };
      }
      if (id === 'state-p1-journals') {
        return { set textContent(value) { uiState.p1 = value; } };
      }
      if (id === 'state-seed') {
        return { set textContent(value) { uiState.seed = value; } };
      }
      if (id === 'seed-input') {
        return {
          get value() {
            return uiState.seedInputValue;
          },
          set value(value) {
            uiState.seedInputValue = value;
          },
        };
      }
      return {
        addEventListener(eventName, callback) {
          listeners[id + ':' + eventName] = callback;
        },
      };
    },
  };

  const currentState = {
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
  };

  globalThis.Unvention = {
    createContainer() {
      return {
        loggerService: {
          logEvent(level, message, context) {
            loggerCalls.push({ level, message, context });
            loggerEntries.push({
              id: loggerEntries.length + 1,
              level,
              message,
              context: context || {},
              timestamp: new Date().toISOString(),
            });
          },
          subscribe(listener) {
            listener(loggerEntries);
            return () => {};
          },
          toSerializableEntries() {
            return loggerEntries;
          },
          replaceEntries(entries) {
            loggerEntries.length = 0;
            loggerEntries.push(...entries);
          },
        },
        gameStateService: {
          getState() {
            return currentState;
          },
          load() {
            return currentState;
          },
          update() {
            return {};
          },
          setState(nextState) {
            Object.assign(currentState, nextState);
            return currentState;
          },
          reset() {
            resetCalled = true;
            return {};
          },
        },
        roundEngineService: {
          initializePlayers(_playerIds) {},
          getJournalingOptions() {
            return [];
          },
          getState() {
            return currentState;
          },
          advancePhase() {
            loggerCalls.push({ level: 'info', message: 'Phase advanced', context: {} });
          },
          updatePlayerJournalCompletion(_playerId, _completedJournals) {
            loggerCalls.push({
              level: 'debug',
              message: 'Journal completion updated',
              context: {},
            });
          },
          setSeed(seed) {
            currentState.rngSeed = String(seed || '').trim() || 'default-seed';
            loggerCalls.push({
              level: 'info',
              message: 'RNG seed updated',
              context: { seed: currentState.rngSeed },
            });
          },
          selectJournalingGroup() {},
          selectJournal() {},
          selectActiveJournalNumber() {},
          placeJournalNumber() {},
        },
      };
    },
    createLogSidebar() {
      return {};
    },
  };

  require('../../src/app/bootstrap.js');

  assert.equal(loggerCalls.length, 2);
  assert.equal(loggerCalls[0].message, 'Logging system initialized');
  assert.equal(uiState.day, 'Friday');
  assert.equal(uiState.phase, 'roll_and_group_dice');
  assert.equal(uiState.seed, 'default-seed');

  listeners['advance-phase:click']();
  listeners['p1-add-journal:click']();
  uiState.seedInputValue = 'abc123';
  listeners['set-seed:click']();
  listeners['reset-game:click']();

  const messages = loggerCalls.map((entry) => entry.message);
  assert.ok(messages.includes('Phase advanced'));
  assert.ok(messages.includes('Journal completion updated'));
  assert.ok(messages.includes('RNG seed updated'));
  assert.ok(messages.includes('Game reset to default state'));
  assert.equal(resetCalled, true);

  delete globalThis.document;
  delete globalThis.Unvention;
});
