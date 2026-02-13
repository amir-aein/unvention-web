const test = require('node:test');
const assert = require('node:assert/strict');

function resetBootstrapModule() {
  delete require.cache[require.resolve('../../src/app/bootstrap.js')];
}

test('bootstrap wires demo button clicks to logger events', () => {
  resetBootstrapModule();

  const listeners = {};
  const loggerCalls = [];

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

  const messages = loggerCalls.map((entry) => entry.message);
  assert.ok(messages.includes('Player explored a safe action'));
  assert.ok(messages.includes('Player tried an out-of-order action'));
  assert.ok(messages.includes('Action failed validation'));

  delete globalThis.document;
  delete globalThis.Unvention;
});
