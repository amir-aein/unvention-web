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

  const makeNode = () => ({
    style: {},
    classList: { toggle() {} },
    set textContent(_value) {},
    set innerHTML(_value) {},
    getAttribute(_name) {
      return '';
    },
    hasAttribute(_name) {
      return false;
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(eventName, callback) {
      listeners[this.__id + ':' + eventName] = callback;
    },
  });

  globalThis.confirm = () => true;
  globalThis.document = {
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    getElementById(id) {
      if (id === 'mp-seed') {
        const node = makeNode();
        node.__id = id;
        Object.defineProperty(node, 'value', {
          get() {
            return uiState.seedInputValue;
          },
          set(value) {
            uiState.seedInputValue = value;
          },
        });
        return node;
      }
      const node = makeNode();
      node.__id = id;
      return node;
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
          logEvent(_level, _message, context) {
            return { id: Date.now(), context: context || {} };
          },
          subscribe(listener) {
            listener([]);
            return () => {};
          },
          toSerializableEntries() {
            return [];
          },
          replaceEntries() {},
          clear() {},
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
          initializePlayers() {},
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
          setSeed() {},
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
    uiState,
  };
}

function cleanupGlobals() {
  delete globalThis.document;
  delete globalThis.confirm;
  delete globalThis.Unvention;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
}

test('multiplayer create action sends create_room and does not start local game', async () => {
  resetBootstrapModule();
  const harness = buildHarness();
  harness.uiState.seedInputValue = 'SEED-123';
  require('../../src/app/bootstrap.js');

  await harness.listeners['home-create-room:click']();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.currentState.gameStarted, false);
  assert.equal(harness.sendCalls.length, 1);
  assert.equal(harness.sendCalls[0].type, 'create_room');
  assert.equal(harness.sendCalls[0].payload.seed, 'SEED-123');

  cleanupGlobals();
});

test('joining an open room from directory sends join_room with selected room code', async () => {
  resetBootstrapModule();
  const harness = buildHarness();
  require('../../src/app/bootstrap.js');

  const clickListener = harness.listeners['mp-room-directory:click'];
  assert.equal(typeof clickListener, 'function');
  clickListener({
    target: {
      closest(selector) {
        if (selector === "button[data-action='join-listed-room']") {
          return {
            getAttribute(name) {
              return name === 'data-room-code' ? 'AB12CD' : '';
            },
          };
        }
        return null;
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.sendCalls.length, 1);
  assert.equal(harness.sendCalls[0].type, 'join_room');
  assert.equal(harness.sendCalls[0].payload.roomCode, 'AB12CD');

  cleanupGlobals();
});
