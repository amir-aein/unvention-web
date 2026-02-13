const test = require('node:test');
const assert = require('node:assert/strict');

function loadInMemoryLogger() {
  delete globalThis.Unvention;
  delete require.cache[require.resolve('../../src/adapters/web/inMemoryLogger.js')];
  require('../../src/adapters/web/inMemoryLogger.js');
  return globalThis.Unvention.InMemoryLogger;
}

test('InMemoryLogger appends, emits, and clears entries', () => {
  const InMemoryLogger = loadInMemoryLogger();
  const logger = new InMemoryLogger();

  const snapshots = [];
  const unsubscribe = logger.subscribe((entries) => {
    snapshots.push(entries.map((entry) => entry.message));
  });

  const first = logger.append({ level: 'info', message: 'first' });
  const second = logger.append({ level: 'warn', message: 'second' });

  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.deepEqual(logger.getEntries().map((entry) => entry.message), ['first', 'second']);
  assert.equal(snapshots.length, 3);

  unsubscribe();
  logger.clear();

  assert.equal(logger.getEntries().length, 0);
});
