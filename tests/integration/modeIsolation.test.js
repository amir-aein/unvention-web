const test = require('node:test');
const assert = require('node:assert/strict');

function resetBootstrapModule() {
  delete require.cache[require.resolve('../../src/app/bootstrap.js')];
}

function createStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
  };
}

function createJsonResponse(payload, statusCode) {
  const status = Number(statusCode || 200);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
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

  const authState = {
    session: {
      user: {
        id: 'user-1',
        email: 'tester@example.com',
        user_metadata: {},
      },
    },
    onChange: null,
  };

  const profileRow = {
    user_id: 'user-1',
    email: 'tester@example.com',
    display_name: 'Tester',
    legacy_profile_token: null,
    last_seen_at: null,
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
  globalThis.location = {
    origin: 'http://localhost:8080',
    protocol: 'http:',
    host: 'localhost:8080',
    hostname: 'localhost',
    port: '8080',
  };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
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

  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          onAuthStateChange(callback) {
            authState.onChange = callback;
            return {
              data: {
                subscription: {
                  unsubscribe() {
                    authState.onChange = null;
                  },
                },
              },
            };
          },
          async getSession() {
            return {
              data: {
                session: authState.session,
              },
            };
          },
          async signInWithOtp() {
            return { error: null };
          },
          async signOut() {
            authState.session = null;
            if (typeof authState.onChange === 'function') {
              authState.onChange('SIGNED_OUT', null);
            }
            return { error: null };
          },
        },
        from(tableName) {
          assert.equal(String(tableName || ''), 'app_users');
          return {
            select() {
              return {
                eq(columnName, value) {
                  const column = String(columnName || '');
                  const userId = String(value || '');
                  return {
                    async maybeSingle() {
                      if (column === 'user_id' && userId === profileRow.user_id) {
                        return { data: { ...profileRow }, error: null };
                      }
                      return { data: null, error: null };
                    },
                  };
                },
              };
            },
            update(patchInput) {
              const patch = patchInput && typeof patchInput === 'object' ? patchInput : {};
              return {
                async eq(columnName, value) {
                  const column = String(columnName || '');
                  const userId = String(value || '');
                  if (column === 'user_id' && userId === profileRow.user_id) {
                    Object.assign(profileRow, patch);
                  }
                  return { error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  globalThis.fetch = async function fetchStub(urlInput) {
    const url = String(urlInput || '');
    if (url.includes('/api/auth/config')) {
      return createJsonResponse({
        ok: true,
        enabled: true,
        url: 'https://project.supabase.co',
        publishableKey: 'sb_publishable_test_key',
        serverTime: Date.now(),
      }, 200);
    }
    if (url.includes('/api/rooms')) {
      return createJsonResponse({ roomList: [] }, 200);
    }
    if (url.includes('/api/profile')) {
      return createJsonResponse({ profile: null, activeRooms: [], recentRooms: [], serverTime: Date.now() }, 200);
    }
    return createJsonResponse({ ok: false, error: 'not_found' }, 404);
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
  delete globalThis.fetch;
  delete globalThis.supabase;
  delete globalThis.location;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
}

async function flushAsyncWork(ticks) {
  const total = Math.max(1, Number(ticks || 1));
  for (let index = 0; index < total; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('multiplayer create action sends create_room and does not start local game', async () => {
  resetBootstrapModule();
  const harness = buildHarness();
  harness.uiState.seedInputValue = 'SEED-123';
  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

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
  await flushAsyncWork(8);

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
