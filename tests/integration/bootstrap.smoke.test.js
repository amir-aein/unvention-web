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
    seed: '',
    seedInputValue: '',
    footerHint: '',
    footerBreadcrumb: '',
  };

  globalThis.document = {
    getElementById(id) {
      if (id === 'state-seed') {
        return { set textContent(value) { uiState.seed = value; } };
      }
      if (id === 'footer-hint') {
        return { set textContent(value) { uiState.footerHint = value; } };
      }
      if (id === 'footer-breadcrumb') {
        return { set textContent(value) { uiState.footerBreadcrumb = value; } };
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
      if (id === 'journal-controls') {
        return {
          style: {},
          set innerHTML(_value) {},
          addEventListener(eventName, callback) {
            listeners[id + ':' + eventName] = callback;
          },
        };
      }
      return {
        style: {},
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
          getPhases() {
            return ['roll_and_group_dice', 'journal', 'workshop', 'build', 'invent'];
          },
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
  assert.equal(uiState.seed, 'default-seed');
  assert.ok(uiState.footerBreadcrumb.includes('Friday'));

  listeners['advance-phase:click']();
  uiState.seedInputValue = 'abc123';
  listeners['set-seed:click']();
  listeners['reset-game:click']();

  const messages = loggerCalls.map((entry) => entry.message);
  assert.ok(messages.includes('Phase advanced'));
  assert.ok(messages.includes('RNG seed updated'));
  assert.ok(messages.includes('Game reset to default state'));
  assert.equal(resetCalled, true);

  delete globalThis.document;
  delete globalThis.Unvention;
});
