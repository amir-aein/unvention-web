const test = require('node:test');
const assert = require('node:assert/strict');

function resetBootstrapModule() {
  delete require.cache[require.resolve('../../src/app/bootstrap.js')];
}

test('bootstrap wires demo button clicks to logger events', () => {
  resetBootstrapModule();

  const listeners = {};
  const loggerCalls = [];
  const subscriptions = [];
  const loggerEntries = [];
  let resetCalled = false;

  globalThis.document = {
    getElementById(id) {
      return {
        addEventListener(eventName, callback) {
          listeners[id + ':' + eventName] = callback;
        },
      };
    },
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
            subscriptions.push(listener);
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
          load() {
            return {
              version: 1,
              currentDay: 'Friday',
              turnNumber: 1,
              phase: 'roll_and_group_dice',
              logs: [],
            };
          },
          update() {
            return {};
          },
          reset() {
            resetCalled = true;
            return {};
          },
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

  listeners['demo-info:click']();
  listeners['demo-warn:click']();
  listeners['demo-error:click']();
  listeners['reset-game:click']();

  const messages = loggerCalls.map((entry) => entry.message);
  assert.ok(messages.includes('Player explored a safe action'));
  assert.ok(messages.includes('Player tried an out-of-order action'));
  assert.ok(messages.includes('Action failed validation'));
  assert.ok(messages.includes('Game reset to default state'));
  assert.equal(resetCalled, true);

  delete globalThis.document;
  delete globalThis.Unvention;
});
