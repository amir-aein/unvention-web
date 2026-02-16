const test = require('node:test');
const assert = require('node:assert/strict');

function resetBootstrapModules() {
  try {
    delete require.cache[require.resolve('../../src/app/bootstrap.js')];
  } catch (_error) {}
  try {
    delete require.cache[require.resolve('../../src/app/flows/homeModeFlow.js')];
  } catch (_error) {}
}

function createStorage() {
  const data = new Map();
  return {
    getItem(key) {
      if (!data.has(String(key))) {
        return null;
      }
      return data.get(String(key));
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

function createHarness(optionsInput) {
  const options = optionsInput && typeof optionsInput === 'object' ? optionsInput : {};
  const initialSession = options.initialSession || null;
  const listeners = {};
  const nodes = new Map();

  class MockHTMLElement {}
  globalThis.HTMLElement = MockHTMLElement;

  class MockNode extends MockHTMLElement {
    constructor(id) {
      super();
      this.__id = String(id || '');
      this.style = {};
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
      this.checked = false;
      this.disabled = false;
      this.className = '';
      this.dataset = {};
      this.classList = {
        toggle() {},
      };
    }

    addEventListener(eventName, callback) {
      listeners[this.__id + ':' + String(eventName || '')] = callback;
    }

    setAttribute(name, value) {
      this[String(name || '')] = value;
    }

    getAttribute(_name) {
      return '';
    }

    hasAttribute(_name) {
      return false;
    }

    closest() {
      return null;
    }

    querySelector() {
      return null;
    }

    querySelectorAll() {
      return [];
    }

    appendChild(_node) {
      return undefined;
    }
  }

  function getNode(id) {
    const key = String(id || '');
    if (!nodes.has(key)) {
      nodes.set(key, new MockNode(key));
    }
    return nodes.get(key);
  }

  globalThis.document = {
    body: {
      appendChild(_node) {},
    },
    createElement(tagName) {
      return new MockNode(String(tagName || 'element'));
    },
    getElementById(id) {
      return getNode(id);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  globalThis.location = {
    origin: 'http://localhost:8080',
    protocol: 'http:',
    host: 'localhost:8080',
    hostname: 'localhost',
    port: '8080',
  };

  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
  globalThis.confirm = () => true;

  const authState = {
    session: initialSession,
    onChange: null,
    signInCalls: [],
    signOutCalls: 0,
  };

  const profileRow = {
    user_id: String(initialSession?.user?.id || 'user-1'),
    email: String(initialSession?.user?.email || 'player@example.com'),
    display_name: 'Player',
    legacy_profile_token: null,
    last_seen_at: null,
  };

  const supabaseClient = {
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
      async signInWithOtp(payload) {
        authState.signInCalls.push(payload);
        return { error: null };
      },
      async signOut() {
        authState.signOutCalls += 1;
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

  globalThis.supabase = {
    createClient() {
      return supabaseClient;
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

  globalThis.Unvention = {
    MultiplayerClient: class MockMultiplayerClient {
      connect() {
        return Promise.resolve();
      }
      disconnect() {}
      send() {
        return true;
      }
      onMessage() {
        return () => {};
      }
      onOpen() {
        return () => {};
      }
      onClose() {
        return () => {};
      }
      onError() {
        return () => {};
      }
    },
    createContainer() {
      return {
        loggerService: {
          logEvent(level, message, context) {
            return {
              id: Date.now(),
              level: String(level || 'info'),
              message: String(message || ''),
              context: context || {},
              timestamp: new Date().toISOString(),
            };
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
          update(partialInput) {
            const partial = partialInput && typeof partialInput === 'object' ? partialInput : {};
            Object.assign(currentState, partial);
            return currentState;
          },
          setState(nextStateInput) {
            const nextState = nextStateInput && typeof nextStateInput === 'object' ? nextStateInput : {};
            Object.assign(currentState, nextState);
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
    getNode,
    authState,
  };
}

async function flushAsyncWork(ticks) {
  const total = Math.max(1, Number(ticks || 1));
  for (let index = 0; index < total; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function cleanupGlobals() {
  delete globalThis.Unvention;
  delete globalThis.document;
  delete globalThis.location;
  delete globalThis.fetch;
  delete globalThis.supabase;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.confirm;
  delete globalThis.HTMLElement;
}

test('auth gate is visible when there is no active session', async () => {
  resetBootstrapModules();
  const harness = createHarness({ initialSession: null });
  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

  assert.equal(harness.getNode('auth-gate-screen').style.display, 'flex');
  assert.equal(harness.getNode('new-game-screen').style.display, 'none');
  assert.equal(harness.getNode('app-shell').style.display, 'none');
  assert.match(String(harness.getNode('auth-login-status-line').textContent || ''), /Not signed in|Checking authentication/);

  cleanupGlobals();
});

test('signed-in session unlocks home screen and logout returns to auth gate', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    initialSession: {
      user: {
        id: 'user-1',
        email: 'player@example.com',
        user_metadata: {},
      },
    },
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

  assert.equal(harness.getNode('auth-gate-screen').style.display, 'none');
  assert.equal(harness.getNode('new-game-screen').style.display, 'flex');
  assert.match(String(harness.getNode('auth-home-status-line').textContent || ''), /Logged in as player@example\.com/);

  const logoutListener = harness.listeners['auth-logout:click'];
  assert.equal(typeof logoutListener, 'function');
  logoutListener();
  await flushAsyncWork(8);

  assert.equal(harness.authState.signOutCalls, 1);
  assert.equal(harness.getNode('auth-gate-screen').style.display, 'flex');
  assert.equal(harness.getNode('new-game-screen').style.display, 'none');

  cleanupGlobals();
});
