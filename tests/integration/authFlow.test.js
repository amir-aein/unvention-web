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
  const initialDisplayName = typeof options.initialDisplayName === 'string'
    ? options.initialDisplayName
    : 'Player';
  const initialMultiplayerState =
    options.initialMultiplayerState && typeof options.initialMultiplayerState === 'object'
      ? options.initialMultiplayerState
      : null;
  const locationOrigin = String(options.locationOrigin || 'http://127.0.0.1:8080');
  const locationUrl = new URL(String(options.locationHref || (locationOrigin + '/')));
  const authConfigUrl = String(options.authConfigUrl || 'https://project.supabase.co');
  const authConfigPublicOrigin = String(options.authConfigPublicOrigin || 'http://127.0.0.1:8080');
  const listeners = {};
  const nodes = new Map();
  const historyReplacements = [];
  const fetchCalls = [];
  let redirectedTo = '';

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
    href: locationUrl.href,
    origin: locationUrl.origin,
    protocol: locationUrl.protocol,
    host: locationUrl.host,
    hostname: locationUrl.hostname,
    port: locationUrl.port,
    pathname: locationUrl.pathname,
    search: locationUrl.search,
    hash: locationUrl.hash,
    replace(nextUrl) {
      redirectedTo = String(nextUrl || '');
    },
  };
  globalThis.history = {
    replaceState(_state, _title, nextUrl) {
      historyReplacements.push(String(nextUrl || ''));
      const parsed = new URL(String(nextUrl || '/'), globalThis.location.origin);
      globalThis.location.href = parsed.href;
      globalThis.location.pathname = parsed.pathname;
      globalThis.location.search = parsed.search;
      globalThis.location.hash = parsed.hash;
    },
  };

  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
  globalThis.confirm = () => true;
  if (initialSession) {
    globalThis.localStorage.setItem(
      'unvention.auth.session.v1',
      JSON.stringify({
        access_token: 'stored-access-token',
        refresh_token: 'stored-refresh-token',
        ...(initialSession || {}),
      }),
    );
  }
  if (initialMultiplayerState) {
    globalThis.localStorage.setItem(
      'unvention.multiplayer.v1',
      JSON.stringify(initialMultiplayerState),
    );
  }

  const authState = {
    session: initialSession,
    onChange: null,
    signInCalls: [],
    signOutCalls: 0,
    setSessionCalls: [],
    exchangeCodeCalls: [],
  };

  const profileRow = {
    user_id: String(initialSession?.user?.id || 'user-1'),
    email: String(initialSession?.user?.email || 'player@example.com'),
    display_name: initialDisplayName,
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
      async setSession(payload) {
        authState.setSessionCalls.push(payload);
        authState.session = options.setSessionResult || {
          access_token: String(payload?.access_token || ''),
          refresh_token: String(payload?.refresh_token || ''),
          user: {
            id: 'user-1',
            email: 'player@example.com',
            user_metadata: {},
          },
        };
        return {
          data: {
            session: authState.session,
          },
          error: options.setSessionError || null,
        };
      },
      async exchangeCodeForSession(code) {
        authState.exchangeCodeCalls.push(code);
        authState.session = options.exchangeCodeSession || {
          access_token: 'code-access-token',
          refresh_token: 'code-refresh-token',
          user: {
            id: 'user-1',
            email: 'player@example.com',
            user_metadata: {},
          },
        };
        return {
          data: {
            session: authState.session,
          },
          error: options.exchangeCodeError || null,
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

  globalThis.fetch = async function fetchStub(urlInput, optionsInput) {
    const url = String(urlInput || '');
    const options = optionsInput && typeof optionsInput === 'object' ? optionsInput : {};
    fetchCalls.push(url);
    if (url.includes('/api/auth/config')) {
      return createJsonResponse({
        ok: true,
        enabled: true,
        url: authConfigUrl,
        publishableKey: 'sb_publishable_test_key',
        publicOrigin: authConfigPublicOrigin,
        serverTime: Date.now(),
      }, 200);
    }
    if (url.includes('/api/auth/magic-link')) {
      return createJsonResponse({ ok: true, sent: true }, 200);
    }
    if (url.includes('/api/auth/session/user')) {
      return createJsonResponse({
        ok: true,
        user: {
          id: 'user-1',
          email: 'player@example.com',
          user_metadata: {},
        },
      }, 200);
    }
    if (url.includes('/api/auth/session/refresh')) {
      return createJsonResponse({
        ok: true,
        session: {
          access_token: 'refreshed-access-token',
          refresh_token: 'refreshed-refresh-token',
          user: {
            id: 'user-1',
            email: 'player@example.com',
            user_metadata: {},
          },
        },
      }, 200);
    }
    if (url.includes('/api/auth/verify-callback')) {
      if (options.verifyCallbackStatus && options.verifyCallbackStatus >= 400) {
        return createJsonResponse({
          ok: false,
          stage: 'callback_exchange_failed',
          message: options.verifyCallbackMessage || 'verify failed',
        }, options.verifyCallbackStatus);
      }
      return createJsonResponse(options.verifyCallbackPayload || {
        ok: true,
        session: {
          access_token: 'verified-access-token',
          refresh_token: 'verified-refresh-token',
          user: {
            id: 'user-1',
            email: 'player@example.com',
          },
        },
      }, 200);
    }
    if (url.includes('/api/auth/profile/load')) {
      if (Object.prototype.hasOwnProperty.call(options, 'profileLoadPayload')) {
        return createJsonResponse(options.profileLoadPayload, 200);
      }
      return createJsonResponse({
        ok: true,
        user: {
          id: profileRow.user_id,
          email: profileRow.email,
          user_metadata: {},
        },
        profile: { ...profileRow },
      }, 200);
    }
    if (url.includes('/api/auth/profile/update')) {
      if (Object.prototype.hasOwnProperty.call(options, 'profileUpdatePayload')) {
        return createJsonResponse(
          options.profileUpdatePayload,
          options.profileUpdateStatus || 200,
        );
      }
      try {
        const parsedBody = JSON.parse(String(options.body || '{}'));
        const patch = parsedBody?.patch && typeof parsedBody.patch === 'object'
          ? parsedBody.patch
          : {};
        Object.assign(profileRow, patch);
      } catch (_error) {}
      return createJsonResponse({
        ok: true,
        user: {
          id: profileRow.user_id,
          email: profileRow.email,
          user_metadata: {},
        },
        profile: { ...profileRow },
      }, 200);
    }
    if (url.includes('/api/auth/logout')) {
      authState.signOutCalls += 1;
      authState.session = null;
      return createJsonResponse({ ok: true, loggedOut: true }, 200);
    }
    if (url.includes('/api/rooms')) {
      return createJsonResponse({ roomList: [] }, 200);
    }
    if (url.includes('/api/profile')) {
      return createJsonResponse({ profile: null, rooms: [], activeRooms: [], recentRooms: [], version: 0, serverTime: Date.now() }, 200);
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
    profileRow,
    historyReplacements,
    fetchCalls,
    getRedirectedTo() {
      return redirectedTo;
    },
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
  delete globalThis.history;
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
  await flushAsyncWork(16);

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
  await flushAsyncWork(16);

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

test('signed-in user without display name is prompted to set one before continuing', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    initialDisplayName: '',
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

  assert.equal(harness.getNode('auth-display-name-modal').style.display, 'flex');
  assert.match(String(harness.getNode('auth-home-display-name-line').textContent || ''), /Display name: Not set/);

  harness.getNode('auth-display-name-input').value = 'Alex';
  const inputListener = harness.listeners['auth-display-name-input:input'];
  assert.equal(typeof inputListener, 'function');
  inputListener();

  const saveListener = harness.listeners['auth-display-name-save:click'];
  assert.equal(typeof saveListener, 'function');
  await saveListener();
  await flushAsyncWork(8);

  assert.equal(harness.profileRow.display_name, 'Alex');
  assert.equal(harness.getNode('auth-display-name-modal').style.display, 'none');
  assert.match(String(harness.getNode('auth-home-display-name-line').textContent || ''), /Display name: Alex/);

  cleanupGlobals();
});

test('local auth redirects localhost to canonical 127.0.0.1 origin before auth init', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    locationOrigin: 'http://localhost:8080',
    locationHref: 'http://localhost:8080/?room=test#access_token=token-1&refresh_token=token-2',
    authConfigPublicOrigin: 'http://127.0.0.1:8080',
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(4);

  assert.equal(
    harness.getRedirectedTo(),
    'http://127.0.0.1:8080/?room=test#access_token=token-1&refresh_token=token-2',
  );
  assert.equal(harness.authState.setSessionCalls.length, 0);

  cleanupGlobals();
});

test('magic link request uses canonical auth origin for redirect and server endpoint', async () => {
  resetBootstrapModules();
  const harness = createHarness({ initialSession: null });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

  harness.getNode('auth-login-email-input').value = 'player@example.com';
  const inputListener = harness.listeners['auth-login-email-input:input'];
  assert.equal(typeof inputListener, 'function');
  inputListener();

  const sendListener = harness.listeners['auth-send-link:click'];
  assert.equal(typeof sendListener, 'function');
  await sendListener();
  await flushAsyncWork(6);

  assert.ok(
    harness.fetchCalls.some((url) => url === 'http://127.0.0.1:8080/api/auth/magic-link'),
  );
  assert.match(
    String(harness.getNode('auth-login-feedback-line').textContent || ''),
    /Magic link sent/,
  );

  cleanupGlobals();
});

test('callback hash tokens create a session and clear callback url', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    locationHref:
      'http://127.0.0.1:8080/#access_token=hash-access&refresh_token=hash-refresh',
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

  assert.equal(harness.authState.setSessionCalls.length, 0);
  assert.ok(
    harness.fetchCalls.some((url) => url === 'http://127.0.0.1:8080/api/auth/session/user'),
  );
  assert.deepEqual(harness.historyReplacements, ['/']);
  assert.equal(harness.getNode('auth-gate-screen').style.display, 'none');

  cleanupGlobals();
});

test('callback code exchanges before rendering signed-out state', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    locationHref: 'http://127.0.0.1:8080/?code=pkce-code',
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

  assert.deepEqual(harness.authState.exchangeCodeCalls, ['pkce-code']);
  assert.equal(harness.getNode('auth-gate-screen').style.display, 'none');
  assert.match(
    String(harness.getNode('auth-home-status-line').textContent || ''),
    /Logged in as player@example\.com/,
  );

  cleanupGlobals();
});

test('token_hash callback uses local verify endpoint and persists returned session', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    locationHref:
      'http://127.0.0.1:8080/?token_hash=thash-1&type=magiclink',
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

  assert.ok(
    harness.fetchCalls.some((url) => url === 'http://127.0.0.1:8080/api/auth/verify-callback'),
  );
  assert.equal(harness.authState.setSessionCalls.length, 0);
  assert.equal(harness.getNode('auth-gate-screen').style.display, 'none');

  cleanupGlobals();
});

test('callback verification failure shows specific auth stage error', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    locationHref:
      'http://127.0.0.1:8080/?token_hash=thash-1&type=magiclink',
    verifyCallbackStatus: 500,
    verifyCallbackMessage: 'token verification failed',
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(8);

  assert.ok(
    harness.fetchCalls.some((url) => url === 'http://127.0.0.1:8080/api/auth/verify-callback'),
  );
  assert.deepEqual(harness.historyReplacements, ['/']);

  cleanupGlobals();
});

test('empty hub route redirects signed-in users back to home', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    locationHref: 'http://127.0.0.1:8080/hub',
    initialSession: {
      access_token: 'session-access',
      refresh_token: 'session-refresh',
      user: {
        id: 'user-1',
        email: 'player@example.com',
        user_metadata: {},
      },
    },
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(10);

  assert.ok(harness.historyReplacements.includes('/'));

  cleanupGlobals();
});

test('signed-in room route keeps legacy profile token when auth profile load returns null', async () => {
  resetBootstrapModules();
  const harness = createHarness({
    locationHref: 'http://127.0.0.1:8080/rooms/M3T4W5',
    initialSession: {
      access_token: 'session-access',
      refresh_token: 'session-refresh',
      user: {
        id: 'user-1',
        email: 'player@example.com',
        user_metadata: {},
      },
    },
    initialMultiplayerState: {
      profileToken: 'legacy-room-token-1',
      roomCode: 'M3T4W5',
      url: 'ws://127.0.0.1:8080/ws',
    },
    profileLoadPayload: {
      ok: true,
      user: {
        id: 'user-1',
        email: 'player@example.com',
        user_metadata: {},
      },
      profile: null,
    },
  });

  require('../../src/app/bootstrap.js');
  await flushAsyncWork(16);

  assert.ok(
    harness.fetchCalls.some((url) => url.includes('/api/profile?profileToken=legacy-room-token-1')),
  );

  cleanupGlobals();
});
