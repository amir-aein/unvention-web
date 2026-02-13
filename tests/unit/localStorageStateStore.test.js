const test = require('node:test');
const assert = require('node:assert/strict');

function loadLocalStorageStateStore() {
  delete globalThis.Unvention;
  delete require.cache[require.resolve('../../src/adapters/web/localStorageStateStore.js')];
  require('../../src/adapters/web/localStorageStateStore.js');
  return globalThis.Unvention.LocalStorageStateStore;
}

test('LocalStorageStateStore saves and loads valid state', () => {
  const LocalStorageStateStore = loadLocalStorageStateStore();

  const storage = {
    data: {},
    getItem(key) {
      return this.data[key] || null;
    },
    setItem(key, value) {
      this.data[key] = value;
    },
    removeItem(key) {
      delete this.data[key];
    },
  };

  const store = new LocalStorageStateStore(storage, 'test.key');
  const state = { version: 1, logs: [{ message: 'saved' }] };

  store.saveState(state);
  const loaded = store.loadState();

  assert.deepEqual(loaded, state);

  store.clearState();
  assert.equal(store.loadState(), null);
});

test('LocalStorageStateStore returns null for invalid JSON', () => {
  const LocalStorageStateStore = loadLocalStorageStateStore();

  const storage = {
    getItem() {
      return '{bad-json';
    },
    setItem() {},
  };

  const store = new LocalStorageStateStore(storage, 'test.key');
  assert.equal(store.loadState(), null);
});
