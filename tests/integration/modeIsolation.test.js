const test = require('node:test');
const assert = require('node:assert/strict');

function resetBootstrapModule() {
  delete require.cache[require.resolve('../../src/app/bootstrap.js')];
}

function buildHarness() {
  const listeners = {};
  const sendCalls = [];
  const uiState = {
    seedInputValue: '',
  };
  const modeButtons = {
    solo: {
      getAttribute(name) {
        return name === 'data-mode' ? 'solo' : '';
      },
      hasAttribute(name) {
        return name === 'disabled' ? false : false;
      },
      classList: { toggle() {} },
    },
    international: {
      getAttribute(name) {
        return name === 'data-mode' ? 'international' : '';
      },
      hasAttribute(name) {
        return name === 'disabled' ? false : false;
      },
      classList: { toggle() {} },
    },
  };
  let initializePlayersCalls = 0;
  let setSeedCalls = 0;

  const currentState = {
    version: 1,
    currentDay: 'Friday',
    turnNumber: 1,
    phase: 'journal',
    gameStatus: 'active',
    gameStarted: false,
    players: [],
    rngSeed: 'default-seed',
    rngState: 3288473048,
    gameConfig: {
      journalCount: 3,
      workshopCount: 4,
      ruleset: null,
      modId: 'classic',
      setupSteps: [],
    },
    rollAndGroup: {
      dice: [],
      outcomeType: null,
      groups: [],
      rolledAtTurn: null,
      rolledAtDay: null,
    },
    logs: [],
  };

  globalThis.confirm = () => true;
  globalThis.document = {
    querySelectorAll(selector) {
      if (selector === '#game-mode-toggle [data-mode]') {
        return [modeButtons.solo, modeButtons.international];
      }
      return [];
    },
    getElementById(id) {
      if (id === 'new-game-seed') {
        return {
          get value() {
            return uiState.seedInputValue;
          },
          set value(value) {
            uiState.seedInputValue = value;
          },
          addEventListener(eventName, callback) {
            listeners[id + ':' + eventName] = callback;
          },
        };
      }
      if (id === 'footer-hint' || id === 'footer-breadcrumb') {
        return {
          set textContent(_value) {},
          set innerHTML(_value) {},
          addEventListener(eventName, callback) {
            listeners[id + ':' + eventName] = callback;
          },
        };
      }
      return {
        style: {},
        classList: { toggle() {} },
        set textContent(_value) {},
        set innerHTML(_value) {},
        getAttribute(name) {
          if (name === 'data-mode') {
            return 'solo';
          }
          return '';
        },
        hasAttribute(_name) {
          return false;
        },
        closest(_selector) {
          return null;
        },
        addEventListener(eventName, callback) {
          listeners[id + ':' + eventName] = callback;
        },
      };
    },
  };

  globalThis.Unvention = {
    MultiplayerClient: class MockMultiplayerClient {
      connect() {
        return Promise.resolve();
      }
      disconnect() {}
      send(type, payload) {
        sendCalls.push({ type, payload: payload || {} });
        return true;
      }
      onMessage() { return () => {}; }
      onOpen() { return () => {}; }
      onClose() { return () => {}; }
      onError() { return () => {}; }
    },
    createContainer() {
      return {
        loggerService: {
          logEvent(_level, _message, _context) {
            return { id: Date.now(), context: _context || {} };
          },
          subscribe(listener) {
            listener([]);
            return () => {};
          },
          toSerializableEntries() {
            return [];
          },
          replaceEntries() {},
        },
        gameStateService: {
          getState() {
            return currentState;
          },
          load() {
            return currentState;
          },
          update(partial) {
            Object.assign(currentState, partial || {});
            return currentState;
          },
          setState(nextState) {
            Object.assign(currentState, nextState || {});
            return currentState;
          },
          reset() {
            currentState.gameStarted = false;
            return currentState;
          },
        },
        roundEngineService: {
          initializePlayers() {
            initializePlayersCalls += 1;
          },
          getPhases() {
            return ['journal', 'workshop', 'build', 'invent'];
          },
          getJournalingOptions() {
            return [];
          },
          getState() {
            return currentState;
          },
          advancePhase() {},
          updatePlayerJournalCompletion() {},
          setSeed() {
            setSeedCalls += 1;
          },
          selectJournalingGroup() {},
          selectJournal() {},
          selectActiveJournalNumber() {},
          placeJournalNumber() {},
          getActiveTools() {
            return [];
          },
          getWorkshoppingOptions() {
            return [];
          },
          getWorkshopNumberChoices() {
            return [];
          },
        },
      };
    },
    createLogSidebar() {
      return {};
    },
  };

  return {
    listeners,
    currentState,
    sendCalls,
    modeButtons,
    getInitializePlayersCalls: () => initializePlayersCalls,
    getSetSeedCalls: () => setSeedCalls,
  };
}

function cleanupGlobals() {
  delete globalThis.document;
  delete globalThis.confirm;
  delete globalThis.Unvention;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
}

test('solo mode start does not send multiplayer commands', () => {
  resetBootstrapModule();
  const harness = buildHarness();
  require('../../src/app/bootstrap.js');

  harness.listeners['home-mode-continue:click']();

  assert.equal(harness.getInitializePlayersCalls(), 1);
  assert.equal(harness.getSetSeedCalls(), 1);
  assert.equal(harness.currentState.gameStarted, true);
  assert.equal(harness.sendCalls.length, 0);

  cleanupGlobals();
});

test('international mode continue does not trigger solo initialization', () => {
  resetBootstrapModule();
  const harness = buildHarness();
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'unvention.homeUi.v1') {
        return JSON.stringify({
          selectedGameMode: 'international',
          homeStep: 'mode',
        });
      }
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.sessionStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  require('../../src/app/bootstrap.js');

  harness.listeners['home-mode-continue:click']();

  assert.equal(harness.getInitializePlayersCalls(), 0);
  assert.equal(harness.currentState.gameStarted, false);
  assert.equal(harness.sendCalls.length, 0);

  cleanupGlobals();
});
