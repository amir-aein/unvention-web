const test = require('node:test');
const assert = require('node:assert/strict');

function loadLoggerService() {
  delete globalThis.Unvention;
  delete require.cache[require.resolve('../../src/shared/logLevels.js')];
  delete require.cache[require.resolve('../../src/core/services/loggerService.js')];
  require('../../src/shared/logLevels.js');
  require('../../src/core/services/loggerService.js');
  return globalThis.Unvention.LoggerService;
}

test('LoggerService normalizes invalid level and delegates to logger port', () => {
  const LoggerService = loadLoggerService();

  const calls = [];
  const port = {
    append(entry) {
      calls.push(entry);
      return entry;
    },
    clear() {
      calls.push({ type: 'clear' });
    },
    getEntries() {
      return [{ id: 1, level: 'info', message: 'ok' }];
    },
    subscribe(listener) {
      listener(this.getEntries());
      return () => {};
    },
  };

  const service = new LoggerService(port);
  const result = service.logEvent('not-a-level', 'hello', { source: 'test' });

  assert.equal(result.level, 'info');
  assert.equal(result.message, 'hello');
  assert.deepEqual(result.context, { source: 'test' });
  assert.ok(result.timestamp instanceof Date);
  assert.equal(calls[0].level, 'info');

  service.clear();
  assert.equal(calls[1].type, 'clear');
});
